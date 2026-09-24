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

      # ENRICHED VENDOR DATA (WITH MOQ CALCULATIONS)
      ${JSON.stringify(context, null, 2)}

      # HOLISTIC EVALUATION RULES
      1. TRUE LANDED COST: You MUST recommend based on "true_landed_cost_inr". This value already accounts for MOQ inflations, shipping, taxes, and discounts. 
      2. MOQ PENALTY EXPLANATION: If a vendor's "moq_penalty_applied" is "YES", explicitly explain that they were penalized because their Minimum Order Quantity exceeded the buyer's requirement.
      3. RISK FACTORS: You MUST integrate the "vendor_scorecard" (risk rating, compliance, lead time) and "conditional_notes" (e.g. future price increases) into your recommendation logic. 
      4. VENDOR NAMES: ALWAYS refer to the actual "vendor_name" (e.g. "Sarthak Equipment Solutions"), never say "Vendor 1".
      5. FORMATTING: ABSOLUTELY NO MARKDOWN TABLES. Use strictly formatted text, bold headers, and bullet points.
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
