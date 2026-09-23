import { OpenAI } from "openai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing in Vercel.");

    const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey });
    const { question, context, rfxBaseline, chatLog } = await req.json();

    const systemPrompt = `
      # CONTEXT
      You are BidPilot, an enterprise procurement AI evaluating vendor responses. 
      You are advising a corporate buyer. You must remain impartial, analytical, and heavily quantitative.

      # RFX BASELINE (WHAT THE BUYER REQUESTED)
      ${JSON.stringify(rfxBaseline, null, 2)}

      # VENDOR MASTER DATA
      ${JSON.stringify(context, null, 2)}

      # STRICT EVALUATION RULES
      1. RECOMMENDATION: When asked to recommend a winner, you MUST calculate and compare the Total Landed Cost (which includes their base price, discounts, taxes, and shipping). 
      2. RECOMMEND THE LOWEST COST: Recommend the vendor with the lowest Total Landed Cost. Note any missing items or MOQ failures as "Risks", but do not automatically disqualify them unless instructed.
      3. FORMATTING: You MUST format your comparisons using strict Markdown tables (e.g., | Vendor | Landed Cost | Missing Items | Risk |).
      4. CONCISENESS: Output ONLY the table and a 2-sentence executive summary. No conversational filler.
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
      model: "openrouter/free",
      messages: messages as any,
    });

    let reply = completion.choices[0]?.message?.content || "No response generated.";
    
    // STRIP API ARTIFACTS
    reply = reply.replace(/User Safety:.*?Response Safety:.*?(\n|$)/gi, "").trim();

    return NextResponse.json({ text: reply });

  } catch (err: any) {
    console.error("Chat API Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
