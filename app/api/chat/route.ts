import { OpenAI } from "openai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing in Vercel.");

    // OpenRouter uses the exact same format as the standard OpenAI SDK
    const openai = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: apiKey,
    });

    const { question, context, chatLog } = await req.json();

    const systemPrompt = `
      You are the lead procurement analyst copilot for Aerchain. Advise a category buyer with a ₹4 crore budget.
      
      Master Data Context:
      ${JSON.stringify(context, null, 2)}
      
      Rules:
      1. Use ONLY the provided Master Data. Do not hallucinate math or vendor names.
      2. Format your response in clean Markdown (use **bolding**, bullet points, and Markdown tables heavily).
      3. Chain of Thought: If calculating totals or comparing prices, explicitly show the arithmetic line-by-line before declaring an answer.
      4. Factor in the Vendor Scorecard (Risk, Lead Time, Compliance) when making recommendations.
    `;

    // Map the React chat history into the API format
    const messages = [
      { role: "system", content: systemPrompt },
      ...(chatLog || []).map((msg: any) => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.text
      })),
      { role: "user", content: question }
    ];

    const completion = await openai.chat.completions.create({
      model: "openrouter/free", // Automatically routes to the highest-availability free reasoning model
      messages: messages as any,
    });

    return NextResponse.json({ text: completion.choices[0].message.content });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
