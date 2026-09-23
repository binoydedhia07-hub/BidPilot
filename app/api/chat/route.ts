import { OpenAI } from "openai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing in Vercel.");

    const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey });
    
    // 1. EXTRACT RFX BASELINE HERE
    const { question, context, rfxBaseline, chatLog } = await req.json();

    const systemPrompt = `
      # CONTEXT
      You are BidPilot, an enterprise procurement AI evaluating vendor responses. 
      You are advising a corporate buyer. You must remain impartial, analytical, and strictly grounded in the provided data.

      # RFX BASELINE (WHAT THE BUYER REQUESTED)
      ${JSON.stringify(rfxBaseline, null, 2)}

      # VENDOR MASTER DATA (WHAT THE VENDORS QUOTED)
      ${JSON.stringify(context, null, 2)}

      # TASK
      1. Cross-reference the Vendor Master Data against the RFx Baseline.
      2. If asked about item availability or if a bid is complete, explicitly check if the vendor provided a quote for every single item listed in the RFx Baseline. 
      3. A vendor is automatically disqualified from winning if they failed to quote an item requested in the RFx Baseline.
      4. Defend your recommendations using exact numerical evidence.

      # FORMAT
      - Output strictly in clean, professional Markdown.
      - Never use prefixes like "User Safety: safe".
      - Keep responses concise, direct, and executive-ready.
    `;

    const messages = [
      { role: "system", content: systemPrompt },
      ...(chatLog || []).map((msg: any) => ({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.apiText || msg.text,
      })),
      { role: "user", content: question }
    ];

    const completion = await openai.chat.completions.create({
      model: "openrouter/free", // Or your preferred chat model
      messages: messages as any,
    });

    const reply = completion.choices[0]?.message?.content || "No response generated.";
    return NextResponse.json({ text: reply });

  } catch (err: any) {
    console.error("Chat API Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
