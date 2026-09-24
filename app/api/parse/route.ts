import { GoogleGenerativeAI } from "@google/generative-ai";
import { OpenAI } from "openai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const vendorName = (formData.get("vendorName") as string) || "Vendor";
    
    const rfxCategories = formData.get("rfxCategories") || "[]";
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "application/octet-stream";
    const isImage = mimeType.startsWith("image/") && !mimeType.includes("svg");

    const prompt = `
      You are an expert enterprise procurement parsing engine.
      
      CRITICAL INSTRUCTION: Extract EVERY line item, product, or fee.
      
      LOT PRICING & UNIT NORMALIZATION (CRITICAL):
      - If a vendor quotes per lot/bundle (e.g. "$510.00 / 1000 pcs", "Rs 1000 for 1000 pieces", "Rs 200 for 10 rolls"):
        1. Calculate the TRUE SINGLE-UNIT PRICE: divide the price by the lot quantity (e.g. 510 / 1000 = 0.51).
        2. Set "unit_price" to this calculated single-unit figure.
        3. Set "quoted_uom" to the base unit (e.g. "pieces", "rolls", "kg").
        4. Set "quoted_qty" to the lot quantity (e.g. 1000).
      
      NORMALIZATION RULES:
      1. EXACT DESCRIPTION: Capture the exact text written on the vendor's quote. Escape all quotation marks (e.g., 3\\").
      2. SEMANTIC MATCHING: Compare the item to this strict RFx Baseline: ${rfxCategories}. Map it to "master_item_category" if it logically matches, otherwise leave blank.
      3. UoM & MOQ: Extract the unit of measure and MOQ (default 0).
      4. COMMERCIALS & CONDITIONS: Extract currency, taxes, immediate flat discounts, shipping, and warranty. 
         CRITICAL: If a discount or rebate is conditional (e.g. "5% rebate if annual order volume exceeds $150,000") or refers to future changes ("20% increase post Dec"), put it in "conditional_notes". Do NOT put it in "immediate_discount_pct".
      
      Return ONLY a pure valid JSON object with this exact schema:
      {
        "vendor_name": "${vendorName}",
        "commercials": {
          "currency": "String (e.g., INR, USD, EUR)",
          "payment_terms": "String",
          "freight_terms": "String",
          "warranty_terms": "String (e.g., 1 Year, None)",
          "immediate_discount_pct": "Number (ONLY if unconditional, else 0)",
          "tax_pct": "Number (default 0)",
          "shipping_cost_flat": "Number (default 0)",
          "conditional_notes": ["Array of Strings"]
        },
        "line_items": [
          {
            "id": 1,
            "vendor_raw_description": "String",
            "master_item_category": "String",
            "quoted_qty": "Number",
            "quoted_uom": "String",
            "unit_price": "Number (SINGLE UNIT PRICE ONLY)",
            "moq_required": "Number"
          }
        ]
      }
    `;
    
    let rawText = "";

    try {
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) throw new Error("Gemini key missing");

      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        generationConfig: { responseMimeType: "application/json" }
      });

      const result = await model.generateContent([
        prompt,
        { inlineData: { data: buffer.toString("base64"), mimeType: mimeType } }
      ]);
      rawText = result.response.text();
      
    } catch (geminiErr) {
      console.warn("Gemini primary parser failed, falling back to OpenRouter...", geminiErr);
      const openRouterApiKey = process.env.OPENROUTER_API_KEY;
      if (!openRouterApiKey) throw new Error("API keys failed.");

      const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: openRouterApiKey });
      const fallbackModel = isImage ? "openai/gpt-4o-mini" : "openrouter/free";
      
      const messageContent: any[] = isImage 
        ? [ { type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mimeType};base64,${buffer.toString("base64")}` } } ]
        : [ { type: "text", text: `${prompt}\n\nDocument Data:\n${buffer.toString("utf-8")}` } ];

      const completion = await openai.chat.completions.create({
        model: fallbackModel,
        messages: [{ role: "user", content: messageContent }],
        response_format: { type: "json_object" }
      });
      rawText = completion?.choices?.[0]?.message?.content || "{}";
    }

    let cleanJson = rawText.replace(/```json|```/g, "").trim();
    const startIndex = cleanJson.indexOf('{');
    const endIndex = cleanJson.lastIndexOf('}');
    cleanJson = (startIndex !== -1 && endIndex !== -1) ? cleanJson.substring(startIndex, endIndex + 1) : "{}";

    const parsedData = JSON.parse(cleanJson);

    const uniqueItems = new Map();
    (parsedData.line_items || []).forEach((item: any) => {
      const desc = item.vendor_raw_description || item.description || "unknown";
      const key = desc.toLowerCase().trim();
      if (!uniqueItems.has(key) || (item.quoted_qty > 0 && uniqueItems.get(key).quoted_qty === 0)) {
        uniqueItems.set(key, item);
      }
    });
    parsedData.line_items = Array.from(uniqueItems.values());

    return NextResponse.json(parsedData);
  } catch (err: any) {
    console.error("Parse API Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
