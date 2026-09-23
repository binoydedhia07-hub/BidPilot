import { OpenAI } from "openai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing in Vercel.");

    const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey });
    const { question, context, chatLog } = await req.json();

    const systemPrompt = `
      You are BidPilot, an enterprise procurement AI. You analyze vendor quotes objectively.
      
      MASTER DATA CONTEXT:
      ${JSON.stringify(context, null, 2)}
      
      ENTERPRISE GUARDRAILS (CRITICAL):
      1. DOMAIN RESTRICTION: You ONLY answer questions related to vendor comparison, pricing, and the provided Master Data.
      2. COMPLETENESS CHECK: Before recommending a winner, you MUST verify that the competing vendors have quoted all required line items and quantities. If a vendor is missing items, or if their total landed cost is mathematically impossible given the required quantities, you must DISQUALIFY them and recommend the vendor with a complete, valid bid.
      3. ZERO HALLUCINATION: You cannot invent vendors or prices.
      4. FORMATTING: Output strictly in Markdown. NEVER output prefixes like "User Safety: safe".
    `;

    const messages = [
      { role: "system", content: systemPrompt },
      ...(chatLog || []).map((msg: any) => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        // Do not send previous UI-only display messages, only the actual context
        content: msg.apiText || msg.text 
      })),
      { role: "user", content: question }
    ];

    const completion = await openai.chat.completions.create({
      model: "openrouter/free", 
      messages: messages as any,
    });

    let rawOutput = completion.choices[0]?.message?.content || "";
    
    // QA FIX: Aggressively strip OpenRouter/Google safety string injections
    rawOutput = rawOutput.replace(/User Safety:\s*safe/gi, "").trim();
    
    // Fallback if the model *only* returned the safety string
    if (!rawOutput) {
       rawOutput = "I have analyzed the data, but the API filtered the response. Please try clicking the action again.";
    }

    return NextResponse.json({ text: rawOutput });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
