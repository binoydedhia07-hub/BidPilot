import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured in Vercel." }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const vendorName = (formData.get("vendorName") as string) || "Vendor";

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64Data = buffer.toString("base64");

    const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

    const prompt = `
      You are an expert enterprise procurement parsing engine. 
      Read this document (which may be an angled photo, handwritten note, raw email, or complex rate sheet).
      Extract all commercial terms and every quoted line item. Check footnotes, headers, stamps, and margins for hidden cash discounts, delivery terms, or MOQ conditions.

      Return ONLY a pure valid JSON object (no markdown formatting, no backticks, no text before or after) with this schema:
      {
        "vendor_name": "${vendorName}",
        "commercials": {
          "currency": "INR or USD",
          "payment_terms": "e.g., Net 30, 2% 10 Net 30",
          "freight_terms": "e.g., Included, Extra 2%, Ex-Works"
        },
        "line_items": [
          {
            "id": 1,
            "description": "Standardized item description",
            "quoted_qty": 1000,
            "quoted_uom": "per pc / per 1000 pcs / per kg",
            "unit_price": 42.50,
            "source_citation": "Exact snippet or location in file where price was found"
          }
        ]
      }
    `;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: file.type || "image/jpeg"
        }
      }
    ]);

    const rawText = result.response.text();
    const cleanJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsedData = JSON.parse(cleanJson);

    // Live Currency Lookup for Deterministic Normalization
    let usdToInr = 86.5;
    try {
      const fxRes = await fetch("https://open.er-api.com/v6/latest/USD");
      const fxJson = await fxRes.json();
      if (fxJson?.rates?.INR) {
        usdToInr = fxJson.rates.INR;
      }
    } catch {
      // Fallback rate if network lookup fails
    }

    // Deterministic Normalization Loop
    parsedData.line_items = parsedData.line_items.map((item: any) => {
      let finalPrice = Number(item.unit_price) || 0;
      let conversionLog = [];

      // Currency conversion
      if (parsedData.commercials.currency?.toUpperCase() === "USD") {
        finalPrice = finalPrice * usdToInr;
        conversionLog.push(`USD to INR @ ₹${usdToInr.toFixed(2)}`);
      }

      // Unit-of-Measure standardization
      const uomLower = (item.quoted_uom || "").toLowerCase();
      if (uomLower.includes("1000") || uomLower.includes("1k")) {
        finalPrice = finalPrice / 1000;
        conversionLog.push("Converted per 1,000 to per single unit");
      }

      return {
        ...item,
        normalized_price_inr: finalPrice,
        audit_trail: `${conversionLog.join(" | ") || "Direct Rate"} [Source: "${item.source_citation || "Extracted from document"}"]`
      };
    });

    return NextResponse.json(parsedData);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to process quote" }, { status: 500 });
  }
}
