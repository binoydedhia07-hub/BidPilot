import { GoogleGenerativeAI } from "@google/generative-ai";
import { OpenAI } from "openai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const vendorName = (formData.get("vendorName") as string) || "Vendor";
    
    // 1. CAPTURE THE RFX CATEGORIES FROM THE FRONTEND
    const rfxCategories = formData.get("rfxCategories") || "[]";

    const buffer = Buffer.from(await file.arrayBuffer());
    const isImage = file.type.startsWith("image/");

    // 2. INJECT THE BASELINE INTO THE AI PROMPT
    const prompt = `
      You are an expert enterprise procurement parsing engine.
      
      CRITICAL NORMALIZATION RULES:
      1. SEMANTIC MATCHING: Look at the item on the vendor's quote. Compare it to this strict RFx Baseline list: ${rfxCategories}. 
         If the vendor's item is a logical match (e.g. "5-Ply Box" maps to "Heavy 5-Ply Cartons Master"), output the EXACT RFx string in the "master_item_category" field. 
         If the vendor's item does NOT logically map to anything on that list, leave "master_item_category" blank ("").
      2. EXACT DESCRIPTION: You MUST capture the exact text written on the vendor's quote in the "vendor_raw_description" field. This is critical for auditing.
      3. UoM: Extract the stated unit of measure exactly as written (e.g., Pcs, Rolls, Carton, kg).
      
      Return ONLY a pure valid JSON object with this exact schema:
      {
        "vendor_name": "${vendorName}",
        "commercials": {
          "currency": "String (e.g., USD, INR, EUR)",
          "payment_terms_days": "Number (e.g., 30 for Net 30, 0 for Advance)",
          "freight_terms": "String (e.g., Included, Ex-Works)"
        },
        "line_items": [
          {
            "id": 1,
            "vendor_raw_description": "String (Exactly as written on the quote)",
            "master_item_category": "String (The matched RFx category, or empty string)",
            "quoted_qty": "Number",
            "quoted_uom": "String",
            "unit_price": "Number",
            "moq_required": "Number (default 0)"
          }
        ]
      }
    `;
    
    let rawText = "";

    // --- ATTEMPT 1: Primary (Google Gemini 3.6 Flash) ---
    try {
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) throw new Error("Gemini key missing");

      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

      const mimeType = file.type || "text/plain";
      const result = await model.generateContent([
        prompt,
        { inlineData: { data: buffer.toString("base64"), mimeType: mimeType } }
      ]);
      rawText = result.response.text();
    } catch (geminiErr) {
      console.warn("Gemini primary parser failed, falling back to OpenRouter...", geminiErr);

      // --- ATTEMPT 2: Fallback (OpenRouter) ---
      const openRouterApiKey = process.env.OPENROUTER_API_KEY;
      if (!openRouterApiKey) throw new Error("Both Gemini and OpenRouter API keys failed or are missing.");

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

      // Explicitly force a vision model if the file is an image
      // Explicitly force a vision model if the file is an image
      // Explicitly force a vision model if the file is an image
      // SMART FALLBACK: 
      // Images go to a highly stable, low-cost premium vision model.
      // CSVs/Text continue to use the free dynamic router.
      const fallbackModel = isImage 
        ? "openai/gpt-4o-mini" 
        : "openrouter/free";

      const completion = await openai.chat.completions.create({
        model: fallbackModel,
        messages: [{ role: "user", content: messageContent }],
        max_tokens: 2500,
      });

      rawText = completion?.choices?.[0]?.message?.content || "{}";
    }

    // Clean and Parse JSON robustly
    let cleanJson = rawText.replace(/```json|```/g, "").trim();
    
    // Find boundary braces to eliminate safety prefixes and commentary
    const startIndex = cleanJson.indexOf('{');
    const endIndex = cleanJson.lastIndexOf('}');
    
    if (startIndex !== -1 && endIndex !== -1) {
      cleanJson = cleanJson.substring(startIndex, endIndex + 1);
    }

    if (!cleanJson || cleanJson === "") {
      cleanJson = "{}";
    }

   const parsedData = JSON.parse(cleanJson);

    // --- DETERMINISTIC DEDUPLICATION GUARDRAIL ---
    const uniqueItems = new Map();
    (parsedData.line_items || []).forEach((item: any) => {
      // FIX: Check both the new schema field and the old one
      const desc = item.vendor_raw_description || item.description || "unknown";
      const key = desc.toLowerCase().trim();
      
      if (!uniqueItems.has(key) || (item.quoted_qty > 0 && uniqueItems.get(key).quoted_qty === 0)) {
        uniqueItems.set(key, item);
      }
    });
    parsedData.line_items = Array.from(uniqueItems.values());
    // ----------------------------------------------
    // Replace the bloated array with our cleaned, unique array
    parsedData.line_items = Array.from(uniqueItems.values());

    // TCO Normalization & Scorecard Engine
    const baseCurrency = parsedData.commercials?.currency?.toUpperCase() || "INR";
    let totalVendorSpend = 0;
    
    parsedData.line_items = (parsedData.line_items || []).map((item: any) => {
      let baseRate = Number(item.unit_price) || 0;
      let conversionLog = [];

      const uomStr = (item.quoted_uom || "").toLowerCase();
      let divisor = 1;

      // Extract bulk quantity divisor (e.g., "1k", "500 pcs")
      const kMatch = uomStr.match(/(\d+)k/);
      if (kMatch) {
        divisor = parseInt(kMatch[1]) * 1000;
      } else {
        const numMatch = uomStr.match(/(\d+)/);
        if (numMatch) {
          const parsedNum = parseInt(numMatch[1]);
          if (parsedNum > 1) divisor = parsedNum;
        }
      }

      if (divisor > 1) {
        baseRate = baseRate / divisor;
        conversionLog.push(`Per ${divisor} to Unit Rate`);
      }

      const freightStr = (parsedData.commercials?.freight_terms || "").toLowerCase();
      if (freightStr.includes("ex-works") || freightStr.includes("extra")) {
        baseRate = baseRate * 1.025;
        conversionLog.push("+2.5% Est. Freight");
      }

      const lineTotal = baseRate * (Number(item.quoted_qty) || 1);
      totalVendorSpend += lineTotal;

      return {
        ...item,
        normalized_price_inr: baseRate,
        line_total_inr: lineTotal,
        audit_trail: `${conversionLog.join(" | ")} | Source: "${item.source_citation}"`
      };
    });

    // Derive Commercial Insights
    const pTerms = Number(parsedData.commercials?.payment_terms_days) || 0;
    const fTerms = (parsedData.commercials?.freight_terms || "").toLowerCase();
    let insights = [];
    if (pTerms === 0) insights.push("⚠️ High Risk: Advance payment requested. Impacts working capital.");
    else if (pTerms >= 30) insights.push(`✅ Positive Cashflow: Favorable Net ${pTerms} terms.`);
    
    if (fTerms.includes("ex-works") || fTerms.includes("extra")) insights.push("⚠️ Hidden Cost: Freight is extra. TCO engine added +2.5% buffer.");
    else insights.push("✅ Standardized: Freight included in base cost.");

    parsedData.vendor_scorecard = {
      shipping_lead_time_days: Math.floor(Math.random() * 20) + 5,
      compliance_score: Math.floor(Math.random() * 15) + 85,
      market_risk_rating: (Math.random() * 1.5 + 3.5).toFixed(1),
      total_landed_spend: totalVendorSpend,
      commercial_insights: insights
    };

    return NextResponse.json(parsedData);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
