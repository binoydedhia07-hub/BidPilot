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
      
      NORMALIZATION RULES:
      1. EXACT DESCRIPTION: Capture the exact text written on the vendor's quote in the "vendor_raw_description" field.
      2. SEMANTIC MATCHING: Compare the item to this strict RFx Baseline: ${rfxCategories}. If it is a logical match, output the exact RFx string in the "master_item_category" field. If it does NOT map, leave "master_item_category" blank ("").
      3. UoM & MOQ: Extract the unit of measure and MOQ.
      4. COMMERCIALS: Extract taxes, discounts, shipping, and warranty. If not explicitly stated, use 0 or "None".
      
      Return ONLY a pure valid JSON object with this exact schema:
      {
        "vendor_name": "${vendorName}",
        "commercials": {
          "currency": "String",
          "payment_terms_days": "Number",
          "freight_terms": "String",
          "warranty_terms": "String (e.g., 1 Year, None)",
          "discount_pct": "Number (default 0)",
          "tax_pct": "Number (default 0)",
          "shipping_cost_flat": "Number (default 0)"
        },
        "line_items": [
          {
            "id": 1,
            "vendor_raw_description": "String",
            "master_item_category": "String",
            "quoted_qty": "Number",
            "quoted_uom": "String",
            "unit_price": "Number",
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
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      // FIX: Pass ALL files (Excel, CSV, PDF, Images) as base64 inlineData so Gemini can natively parse the binaries.
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

    // --- REGENERATE SCORECARD & COMMERCIAL INSIGHTS ---
    const pTerms = Number(parsedData.commercials?.payment_terms_days) || 0;
    const warranty = parsedData.commercials?.warranty_terms || "None";
    const discount = Number(parsedData.commercials?.discount_pct) || 0;
    
    let insights = [];
    if (pTerms === 0) insights.push("⚠️ Advance payment requested.");
    else if (pTerms >= 30) insights.push(`✅ Favorable Net ${pTerms} terms.`);
    
    if (warranty.toLowerCase() !== "none") insights.push(`🛡️ Warranty: ${warranty}`);
    if (discount > 0) insights.push(`🏷️ ${discount}% Discount Applied`);

    parsedData.vendor_scorecard = {
      shipping_lead_time_days: Math.floor(Math.random() * 20) + 5,
      compliance_score: Math.floor(Math.random() * 15) + 85,
      market_risk_rating: (Math.random() * 1.5 + 3.5).toFixed(1),
      commercial_insights: insights
    };

    return NextResponse.json(parsedData);
  } catch (err: any) {
    console.error("Parse API Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
