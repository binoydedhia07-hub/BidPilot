"use client";
import { useState } from "react";

export default function Dashboard() {
  const [vendorData, setVendorData] = useState<any[]>([]);
  const [chatLog, setChatLog] = useState<{ role: string; text: string }[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedCell, setSelectedCell] = useState<any>(null);

  const handleFileUpload = async (e: any) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("vendorName", `Vendor ${String.fromCharCode(65 + vendorData.length)}`);

    try {
      const res = await fetch("/api/parse", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Parsing failed");
      setVendorData((prev) => [...prev, data]);
    } catch (err: any) {
      alert("Extraction error: " + err.message);
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  const askCopilot = async () => {
    if (!question.trim()) return;
    const userMsg = { role: "user", text: question };
    setChatLog((prev) => [...prev, userMsg]);
    const currentQ = question;
    setQuestion("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: currentQ, context: vendorData })
      });
      const data = await res.json();
      setChatLog((prev) => [...prev, { role: "assistant", text: data.text }]);
    } catch (err) {
      setChatLog((prev) => [...prev, { role: "assistant", text: "Error connecting to AI Copilot." }]);
    }
  };

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 font-sans overflow-hidden">
      {/* LEFT: Master RFx Grid */}
      <div className="w-2/3 p-6 flex flex-col border-r border-slate-800 overflow-hidden">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Aerchain RFx Copilot</h1>
            <p className="text-sm text-slate-400">Autonomous Extraction, Normalization & Audit Trail</p>
          </div>
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white font-medium px-4 py-2 rounded-lg transition shadow-sm text-sm">
            {loading ? "Extracting with Gemini..." : "+ Ingest Vendor Quote"}
            <input type="file" onChange={handleFileUpload} className="hidden" disabled={loading} />
          </label>
        </div>

        {/* Master Table */}
        <div className="flex-1 overflow-auto bg-slate-950 rounded-xl border border-slate-800 p-4">
          {vendorData.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500">
              <p className="text-base font-medium">No vendor submissions ingested yet.</p>
              <p className="text-xs mt-1">Upload an image, PDF quote, or email draft to see autonomous normalization.</p>
            </div>
          ) : (
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="pb-3 px-3">Line Item</th>
                  {vendorData.map((v, i) => (
                    <th key={i} className="pb-3 px-3">
                      <div>{v.vendor_name}</div>
                      <div className="text-xs font-normal text-slate-500">
                        {v.commercials.currency} | {v.commercials.payment_terms}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {vendorData[0]?.line_items.map((item: any, rowIdx: number) => (
                  <tr key={rowIdx} className="hover:bg-slate-900/50 transition">
                    <td className="py-3 px-3 font-medium text-slate-300">
                      {item.description}
                      <span className="block text-xs text-slate-500">{item.quoted_qty} {item.quoted_uom}</span>
                    </td>
                    {vendorData.map((v, colIdx) => {
                      const vItem = v.line_items[rowIdx] || {};
                      return (
                        <td
                          key={colIdx}
                          onClick={() => setSelectedCell({ vendor: v.vendor_name, item: vItem })}
                          className="py-3 px-3 cursor-pointer hover:bg-blue-950/40 rounded transition"
                        >
                          <div className="font-semibold text-emerald-400">
                            ₹{vItem.normalized_price_inr?.toFixed(2) || "N/A"}
                          </div>
                          <div className="text-xs text-slate-500">
                            Orig: {v.commercials.currency} {vItem.unit_price}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Audit Inspector Panel */}
        {selectedCell && (
          <div className="mt-4 p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs">
            <span className="font-bold text-blue-400">{selectedCell.vendor} Traceability Proof:</span>{" "}
            <span className="text-slate-300">{selectedCell.item?.audit_trail}</span>
          </div>
        )}
      </div>

      {/* RIGHT: Interrogation Copilot */}
      <div className="w-1/3 p-6 flex flex-col bg-slate-950/50">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-white">Interrogate Matrix</h2>
          <p className="text-xs text-slate-400">Query without math hallucinations across all extracted documents</p>
        </div>

        <div className="flex-1 overflow-auto space-y-4 mb-4 pr-1">
          {chatLog.length === 0 ? (
            <div className="text-slate-600 text-sm mt-10 text-center">
              Try asking:
              <button
                onClick={() => setQuestion("Which vendor offers the lowest total landed cost across all lines?")}
                className="block mx-auto mt-2 text-xs text-blue-400 hover:underline text-left bg-slate-900 p-2 rounded border border-slate-800"
              >
                "Which vendor offers the lowest total landed cost across all lines?"
              </button>
              <button
                onClick={() => setQuestion("Compare the payment terms and highlight any hidden discounts.")}
                className="block mx-auto mt-2 text-xs text-blue-400 hover:underline text-left bg-slate-900 p-2 rounded border border-slate-800"
              >
                "Compare payment terms & hidden discounts."
              </button>
            </div>
          ) : (
            chatLog.map((msg, i) => (
              <div
                key={i}
                className={`p-3 rounded-lg text-sm ${
                  msg.role === "user"
                    ? "bg-blue-600/20 border border-blue-500/30 text-blue-100 ml-4"
                    : "bg-slate-900 border border-slate-800 text-slate-200 mr-4 whitespace-pre-line"
                }`}
              >
                <div className="text-[10px] font-bold uppercase text-slate-500 mb-1">
                  {msg.role === "user" ? "Buyer" : "Aerchain Copilot"}
                </div>
                {msg.text}
              </div>
            ))
          )}
        </div>

        <div className="flex gap-2">
          <input
            className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && askCopilot()}
            placeholder="Interrogate quotes in plain language..."
          />
          <button
            onClick={askCopilot}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            Ask
          </button>
        </div>
      </div>
    </div>
  );
}
