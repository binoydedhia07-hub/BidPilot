import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("API Key missing");

    const genAI = new GoogleGenerativeAI(apiKey);
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const vendorName = (formData.get("vendorName") as string) || "Vendor";

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64Data = buffer.toString("base64");

    const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

    const prompt = `
      You are an expert enterprise procurement parsing engine.
      Extract commercial terms, line items, and MOQs.
      Return ONLY a pure valid JSON object with this exact schema:
      {
        "vendor_name": "${vendorName}",
        "commercials": {
          "currency": "String (e.g., USD, INR, EUR)",
          "payment_terms_days": "Number (e.g., 30 for Net 30, 0 for Advance)",
          "early_payment_discount_pct": "Number (default 0)",
          "freight_terms": "String (e.g., Included, Ex-Works)"
        },
        "line_items": [
          {
            "id": 1,
            "description": "String",
            "quoted_qty": "Number",
            "quoted_uom": "String",
            "unit_price": "Number",
            "moq_required": "Number (default 0)",
            "source_citation": "String"
          }
        ]
      }
    `;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Data, mimeType: file.type || "image/jpeg" } }
    ]);

    const cleanJson = result.response.text().replace(/```json|```/g, "").trim();
    const parsedData = JSON.parse(cleanJson);

    // 1. Dynamic Currency Fetching
    const baseCurrency = parsedData.commercials.currency?.toUpperCase() || "INR";
    let conversionRate = 1;
    if (baseCurrency !== "INR") {
      try {
        const fxRes = await fetch(`https://open.er-api.com/v6/latest/${baseCurrency}`);
        const fxJson = await fxRes.json();
        if (fxJson?.rates?.INR) conversionRate = fxJson.rates.INR;
      } catch (e) {
        console.error("FX fetch failed");
      }
    }

    // 2. TCO (Total Cost of Ownership) Normalization
    let totalVendorSpend = 0;
    parsedData.line_items = parsedData.line_items.map((item: any) => {
      let baseRate = Number(item.unit_price) || 0;
      let conversionLog = [];

      // Fix UoM anomalies (like per 1000 pcs)
      const uomLower = (item.quoted_uom || "").toLowerCase();
      if (uomLower.includes("1000") || uomLower.includes("1k")) {
        baseRate = baseRate / 1000;
        conversionLog.push("Per 1k to Unit");
      }

      // Convert to INR
      if (baseCurrency !== "INR") {
        baseRate = baseRate * conversionRate;
        conversionLog.push(`${baseCurrency} to INR @ ₹${conversionRate.toFixed(2)}`);
      }

      // Apply Freight Penalty for Ex-Works (Standardizing at 2.5% penalty if not included)
      const freightStr = (parsedData.commercials.freight_terms || "").toLowerCase();
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

    // 3. Generate Vendor Scorecard
    parsedData.vendor_scorecard = {
      shipping_lead_time_days: Math.floor(Math.random() * 20) + 5, // Mocked 5-25 days
      compliance_score: Math.floor(Math.random() * 15) + 85, // Mocked 85-100 score
      market_risk_rating: (Math.random() * 1.5 + 3.5).toFixed(1), // Mocked 3.5 - 5.0 rating
      total_landed_spend: totalVendorSpend
    };

    return NextResponse.json(parsedData);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
