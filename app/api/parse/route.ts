export const maxDuration = 60;

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
    
    const isBinary = isImage || mimeType.includes("pdf") || mimeType.includes("spreadsheet") || mimeType.includes("excel");

    const prompt = `
      You are an expert enterprise procurement parsing engine.
      
      CRITICAL INSTRUCTIONS FOR MATH, MOQs, AND CURRENCY (READ CAREFULLY):
      1. LOT PRICING (DIVISION REQUIRED): If a vendor quotes a bulk lot (e.g., "$510.00 / 1000 pcs"), you MUST mathematically divide the price by the lot size to get the single-unit price (e.g., 510 / 1000 = 0.51). Set "unit_price": 0.51.
      2. TABULAR UNIT PRICES (NO DIVISION): If the quote has explicit columns for "Qty" and "Unit Price" (e.g., Qty=4000, Unit Price=3350), DO NOT DIVIDE. The "unit_price" is exactly 3350.
      3. CLEAN UoM: "quoted_uom" MUST be letters only (e.g., "pieces", "rolls", "Carton"). NEVER put numbers in the UoM.
      4. MOQ REQUIRED: You MUST extract the Minimum Order Quantity (MOQ). If the text says "MOQ 10000", set "moq_required": 10000. If no MOQ is stated, set 0.
      5. CURRENCY: You MUST extract the currency (e.g., USD, INR, EUR) and place it in "commercials.currency".
      6. EXACT BASELINE MATCH: Compare item to: ${rfxCategories}. If it matches, "master_item_category" MUST be the EXACT identical string. If it does not map, leave blank "".
      
      Return ONLY a pure valid JSON object with this exact schema:
      {
        "vendor_name": "${vendorName}",
        "commercials": {
          "currency": "String",
          "payment_terms": "String",
          "freight_terms": "String",
          "warranty_terms": "String",
          "immediate_discount_pct": "Number",
          "tax_pct": "Number",
          "shipping_cost_flat": "Number",
          "conditional_notes": ["Array of Strings"]
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
      const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        generationConfig: { 
          responseMimeType: "application/json",
          maxOutputTokens: 4096, 
          temperature: 0.0 
        }
      });

      const contents: any[] = [prompt];
      if (isBinary) {
        contents.push({ inlineData: { data: buffer.toString("base64"), mimeType: mimeType } });
      } else {
        contents.push(`\n\nRaw Document Text:\n${buffer.toString("utf-8")}`);
      }

      let timeoutId: any;
      const geminiPromise = model.generateContent(contents);
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Gemini timeout - failing over")), 25000);
      });

      const result: any = await Promise.race([geminiPromise, timeoutPromise]);
      clearTimeout(timeoutId); 
      rawText = result.response.text();
      
    } catch (geminiErr) {
      console.warn("Failover to OpenRouter triggered...", geminiErr);
      const openRouterApiKey = process.env.OPENROUTER_API_KEY;
      if (!openRouterApiKey) throw new Error("API keys failed.");

      const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: openRouterApiKey });
      const fallbackModel = "openai/gpt-4o-mini"; 
      
      const messageContent: any[] = [{ type: "text", text: prompt }];

      if (isBinary) {
        messageContent.push({
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${buffer.toString("base64")}` }
        });
      } else {
        messageContent.push({
          type: "text",
          text: `\n\nDocument Text:\n${buffer.toString("utf-8")}`
        });
      }

      const completion = await openai.chat.completions.create({
        model: fallbackModel,
        messages: [{ role: "user", content: messageContent }],
        response_format: { type: "json_object" },
        max_tokens: 4096,
        temperature: 0.0
      });
      rawText = completion?.choices?.[0]?.message?.content || "{}";
    }

    let cleanJson = rawText.replace(/```json|```/g, "").trim();
    const startIndex = cleanJson.indexOf('{');
    const endIndex = cleanJson.lastIndexOf('}');
    cleanJson = (startIndex !== -1 && endIndex !== -1) ? cleanJson.substring(startIndex, endIndex + 1) : "{}";

    let parsedData;
    try {
      parsedData = JSON.parse(cleanJson);
    } catch (jsonErr: any) {
      throw new Error(`JSON Formatting Error: ${jsonErr.message}`);
    }

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
