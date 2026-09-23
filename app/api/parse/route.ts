import { GoogleGenerativeAI } from "@google/generative-ai";
import { OpenAI } from "openai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const vendorName = (formData.get("vendorName") as string) || "Vendor";
    
    // Capture the RFx Categories for Semantic Mapping
    const rfxCategories = formData.get("rfxCategories") || "[]";

    const buffer = Buffer.from(await file.arrayBuffer());
    
    // FIX 1: OpenAI Vision rejects SVGs. Treat SVGs, TXTs, and CSVs as raw text buffers.
    const isImage = file.type.startsWith("image/") && !file.type.includes("svg");

    const prompt = `
      You are an expert enterprise procurement parsing engine.
      
      CRITICAL NORMALIZATION RULES:
      1. SEMANTIC MATCHING: Look at the item on the vendor's quote. Compare it to this strict RFx Baseline list: ${rfxCategories}. 
         If the vendor's item is a logical match, output the EXACT RFx string in the "master_item_category" field. 
         If it does NOT logically map, leave "master_item_category" blank ("").
      2. EXACT DESCRIPTION: Capture the exact text written on the vendor's quote in the "vendor_raw_description" field.
      3. UoM: Extract the stated unit of measure (e.g., Pcs, Rolls, Carton, kg).
      
      CRITICAL INSTRUCTION FOR TEXT/CSV: If the input is tabular text or CSV, treat delimiters (commas, tabs) as columns.
      
      YOU MUST OUTPUT STRICT, VALID JSON ONLY. NO CONVERSATIONAL TEXT. NO MARKDOWN.
      
      Return ONLY a pure valid JSON object with this exact schema:
      {
        "vendor_name": "${vendorName}",
        "commercials": {
          "currency": "String",
          "payment_terms_days": "Number",
          "freight_terms": "String"
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

    // --- ATTEMPT 1: Primary (Google Gemini) ---
    try {
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) throw new Error("Gemini key missing");

      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      if (isImage) {
        const result = await model.generateContent([
          prompt,
          { inlineData: { data: buffer.toString("base64"), mimeType: file.type } }
        ]);
        rawText = result.response.text();
      } else {
        const result = await model.generateContent([
          `${prompt}\n\nHere is the document text/CSV:\n${buffer.toString("utf-8")}`
        ]);
        rawText = result.response.text();
      }
    } catch (geminiErr) {
      console.warn("Gemini primary parser failed, falling back to OpenRouter...", geminiErr);

      // --- ATTEMPT 2: Fallback (OpenRouter / OpenAI) ---
      const openRouterApiKey = process.env.OPENROUTER_API_KEY;
      if (!openRouterApiKey) throw new Error("Both Gemini and OpenRouter API keys failed.");

      const openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: openRouterApiKey,
      });

      let messageContent: any[];
      if (isImage) {
        messageContent = [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${file.type};base64,${buffer.toString("base64")}` } }
        ];
      } else {
        messageContent = [
          { type: "text", text: `${prompt}\n\nHere is the raw document data to parse:\n${buffer.toString("utf-8")}` }
        ];
      }

      const fallbackModel = isImage ? "openai/gpt-4o-mini" : "openrouter/free";

      const completion = await openai.chat.completions.create({
        model: fallbackModel,
        messages: [{ role: "user", content: messageContent }],
        max_tokens: 2500,
        // FIX 2: Force the API to return JSON, preventing conversational hallucinations
        response_format: { type: "json_object" } 
      });

      rawText = completion?.choices?.[0]?.message?.content || "{}";
    }

    // FIX 3: Ironclad JSON extraction to prevent the "Unexpected token W" crash
    let cleanJson = rawText.replace(/```json|```/g, "").trim();
    const startIndex = cleanJson.indexOf('{');
    const endIndex = cleanJson.lastIndexOf('}');
    
    if (startIndex !== -1 && endIndex !== -1) {
      cleanJson = cleanJson.substring(startIndex, endIndex + 1);
    } else {
      cleanJson = "{}";
    }

    const parsedData = JSON.parse(cleanJson);

    // --- DETERMINISTIC DEDUPLICATION ---
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
