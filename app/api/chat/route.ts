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
      1. DOMAIN RESTRICTION: You ONLY answer questions related to vendor comparison, pricing, and the provided Master Data. If the user asks off-topic questions (e.g., "what is 2+2", coding, general trivia, weather), you MUST reply exactly: "I am BidPilot. I can only assist with evaluating the active vendor quotes."
      2. ANTI-SYCOPHANCY: You are an impartial, deterministic mathematical engine. NEVER change your recommendation just because a user suggests a different vendor or disagrees. Defend the data objectively based purely on TCO and Risk.
      3. ZERO HALLUCINATION: You cannot invent vendors, prices, or metrics. If the context is empty, tell the user to upload a quote.
      4. FORMAT & CONCISENESS: Be extremely crisp. Do not use long intros. Answer in 2-3 short sentences explaining exactly WHY a decision was made, followed by a clean Markdown table.
    `;

    const messages = [
      { role: "system", content: systemPrompt },
      ...(chatLog || []).map((msg: any) => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.text
      })),
      { role: "user", content: question }
    ];

    const completion = await openai.chat.completions.create({
      model: "openrouter/free", 
      messages: messages as any,
    });

    return NextResponse.json({ text: completion.choices[0].message.content });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
