import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured." }, { status: 500 });
    }

    const { question, context } = await req.json();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

    const prompt = `
      You are the lead procurement analyst copilot for Aerchain.
      You are advising a category buyer with ₹4 crore on the line.

      Normalized Submissions Context:
      ${JSON.stringify(context, null, 2)}

      Buyer Inquiry: "${question}"

      Instructions:
      1. Strictly compute numbers from normalized_price_inr and stated commercial terms. Never invent prices.
      2. If calculating total spend or split scenarios, display a short breakdown showing your arithmetic.
      3. If a vendor missed a line or has non-standard freight/cash discount terms, explicitly call it out.
      4. End with an actionable recommendation (e.g. single-source vs split-award).
    `;

    const result = await model.generateContent(prompt);
    return NextResponse.json({ text: result.response.text() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Copilot error" }, { status: 500 });
  }
}
