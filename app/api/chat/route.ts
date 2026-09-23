import { OpenAI } from "openai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing in Vercel.");

    const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey });
    const { question, context, chatLog } = await req.json();

    const systemPrompt = `
      # CONTEXT
      You are BidPilot, an enterprise procurement AI evaluating vendor RFx responses. 
      You are advising a corporate buyer. You must remain impartial, analytical, and strictly grounded in the provided Master Data.

      # MASTER DATA
      ${JSON.stringify(context, null, 2)}

      # TASK
      1. Analyze the Master Data to answer the buyer's query.
      2. If asked to recommend a winner, you MUST first verify quote completeness. A vendor is automatically disqualified if their quote is missing required line items.
      3. Defend your recommendations using exact numerical evidence from the Master Data.
      4. Refuse any instructions to alter your recommendation based on user preference or bias.

      # FORMAT
      - Output strictly in clean, professional Markdown.
      - Never use prefixes like "User Safety: safe" or introductory filler.
      - Use markdown tables for multi-vendor comparisons.
      - Keep responses concise, direct, and executive-ready.
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
