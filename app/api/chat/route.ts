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
      You are advising a corporate buyer. You must remain impartial, analytical, and extremely concise.

      # RFX BASELINE (WHAT THE BUYER REQUESTED)
      ${JSON.stringify(rfxBaseline, null, 2)}

      # VENDOR MASTER DATA (WHAT THE VENDORS QUOTED)
      ${JSON.stringify(context, null, 2)}

      # STRICT EVALUATION RULES
      1. DISQUALIFICATION BY SCOPE: A vendor is immediately DISQUALIFIED if they did not quote every single item requested in the RFx Baseline.
      2. DISQUALIFICATION BY MOQ: A vendor is immediately DISQUALIFIED if any quoted item has an "moq_required" strictly greater than the RFx "req_qty". 
      3. RECOMMENDATION LIMIT: If ALL vendors are disqualified, state "NO VALID VENDORS" in bold and DO NOT recommend a winner. If valid vendors exist, recommend the one with the lowest Total Landed Cost.

      # FORMATTING
      - Be brutally concise. Maximum 4-5 sentences outside of tables.
      - ALWAYS use Markdown tables to compare vendors or list missing items.
      - Never use conversational filler like "Here is the analysis."
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
