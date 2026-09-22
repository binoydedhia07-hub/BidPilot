import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("API Key missing");

    const { question, context, chatLog } = await req.json();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

    // Format chat history for Gemini
    const history = (chatLog || []).map((msg: any) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.text }]
    }));

    const systemPrompt = `
      You are the lead procurement analyst copilot for Aerchain. Advise a category buyer with a ₹4 crore budget.
      
      Master Data Context:
      ${JSON.stringify(context, null, 2)}
      
      Rules:
      1. Use ONLY the provided Master Data.
      2. Format your response in clean Markdown (use **bolding**, bullet points, and Markdown tables heavily).
      3. Chain of Thought: If calculating totals or comparing prices, briefly show the arithmetic (e.g., Base + Freight = Total).
      4. Factor in the Vendor Scorecard (Risk, Lead Time, Compliance) when making recommendations.
    `;

    // Inject system rules as the first hidden interaction
    const chat = model.startChat({
      history: [
        { role: "user", parts: [{ text: systemPrompt }] },
        { role: "model", parts: [{ text: "Acknowledged. I will strictly adhere to the master data, show my math, and use Markdown formatting." }] },
        ...history
      ]
    });

    const result = await chat.sendMessage(question);
    return NextResponse.json({ text: result.response.text() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
