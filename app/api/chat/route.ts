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

      # RFX BASELINE (WHAT THE BUYER REQUESTED)
      ${JSON.stringify(rfxBaseline, null, 2)}

      # VENDOR MASTER DATA
      ${JSON.stringify(context, null, 2)}

      # STRICT EVALUATION RULES
      1. VENDOR IDENTIFICATION: ALWAYS refer to the vendors by their actual "vendor_name" (e.g., "Sarthak Equipment Solutions"), NEVER say "Vendor 1".
      2. RECOMMENDATION: When recommending a winner, compare the Total Landed Cost (Subtotal - Discount + Tax + Shipping).
      3. CONDITIONAL NOTES: Pay close attention to "conditional_notes" (e.g., future price hikes, cash discounts) and "warranty_terms". Explicitly highlight these conditions in your analysis.
      4. FORMATTING: You MUST format comparisons using clean Markdown tables.
      5. CONCISENESS: Output ONLY the table and a 2-3 sentence executive summary. No conversational filler.
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
