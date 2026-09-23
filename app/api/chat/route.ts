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

      # RFX BASELINE
      ${JSON.stringify(rfxBaseline, null, 2)}

      # ENRICHED VENDOR DATA (WITH CALCULATED TOTALS)
      ${JSON.stringify(context, null, 2)}

      # STRICT EVALUATION RULES
      1. VENDOR IDENTIFICATION: ALWAYS refer to the vendors by their actual "vendor_name".
      2. RECOMMENDATION: Recommend the vendor with the lowest "total_landed_cost_inr". This value already includes base price multiplied by RFx quantity, plus all taxes, discounts, and shipping.
      3. ITEM COSTS: Look at "calculated_line_total_inr" for the exact cost of a line item based on required quantities, NOT just the unit price.
      4. CONDITIONAL NOTES & SCORECARD: Explicitly highlight "conditional_notes" (e.g., future price hikes), warranty, and risk ratings from the vendor scorecard.
      5. FORMATTING: DO NOT USE MARKDOWN TABLES. Use clear, concise bullet points and bold text for readability. Tables fail to render in this environment, so strictly use text formatting.
      6. CONCISENESS: Output a 3-4 sentence executive summary and bullet points. No conversational filler.
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
    reply = reply.replace(/User Safety:.*?Response Safety:.*?(\n|$)/gi, "").trim();

    return NextResponse.json({ text: reply });

  } catch (err: any) {
    console.error("Chat API Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
