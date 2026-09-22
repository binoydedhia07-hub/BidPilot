"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remarkGfm";

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
      if (!res.ok) throw new Error(data.error);
      setVendorData((prev) => [...prev, data]);
    } catch (err: any) {
      alert("Extraction error: " + err.message);
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  const askCopilot = async (overrideQuestion?: string) => {
    const q = overrideQuestion || question;
    if (!q.trim()) return;
    
    const userMsg = { role: "user", text: q };
    setChatLog((prev) => [...prev, userMsg]);
    setQuestion("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send history along with current question
        body: JSON.stringify({ question: q, context: vendorData, chatLog })
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error);
      setChatLog((prev) => [...prev, { role: "assistant", text: data.text }]);
    } catch (err: any) {
      setChatLog((prev) => [...prev, { role: "assistant", text: `Error: ${err.message}` }]);
    }
  };

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 font-sans overflow-hidden">
      {/* LEFT: Master Grid & Scorecards */}
      <div className="w-2/3 p-6 flex flex-col border-r border-slate-800 overflow-hidden">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Aerchain RFx V2</h1>
            <p className="text-sm text-slate-400">TCO Normalization & Risk Scorecards</p>
          </div>
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white font-medium px-4 py-2 rounded-lg transition shadow-sm text-sm">
            {loading ? "Extracting..." : "+ Ingest Vendor Quote"}
            <input type="file" onChange={handleFileUpload} className="hidden" disabled={loading} />
          </label>
        </div>

        <div className="flex-1 overflow-auto bg-slate-950 rounded-xl border border-slate-800 p-4">
          {vendorData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500">Upload a quote to begin.</div>
          ) : (
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                {/* Scorecard Header */}
                <tr className="border-b-2 border-slate-700 bg-slate-900">
                  <th className="p-3">Vendor Scorecard</th>
                  {vendorData.map((v, i) => (
                    <th key={i} className="p-3 font-normal text-xs align-top border-l border-slate-800">
                      <div className="font-bold text-sm text-white mb-1">{v.vendor_name}</div>
                      <div className="text-emerald-400 font-semibold mb-2">
                        Est. Total: ₹{v.vendor_scorecard.total_landed_spend.toLocaleString()}
                      </div>
                      <div className="text-slate-400 space-y-1">
                        <div>Risk Rating: <span className="text-white">{v.vendor_scorecard.market_risk_rating}/5.0</span></div>
                        <div>Lead Time: <span className="text-white">{v.vendor_scorecard.shipping_lead_time_days} days</span></div>
                        <div>Compliance: <span className="text-white">{v.vendor_scorecard.compliance_score}%</span></div>
                        <div className="mt-2 text-blue-400">Terms: {v.commercials.payment_terms_days} days | {v.commercials.freight_terms}</div>
                      </div>
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-slate-800 text-slate-500 text-xs">
                  <th className="p-3">Extracted Line Items</th>
                  {vendorData.map((_, i) => <th key={i} className="p-3 border-l border-slate-800">Normalized Landed Price</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {vendorData[0]?.line_items.map((item: any, rowIdx: number) => (
                  <tr key={rowIdx} className="hover:bg-slate-900/50 transition">
                    <td className="p-3 font-medium text-slate-300">
                      {item.description}
                      <span className="block text-xs text-slate-500">Qty: {item.quoted_qty}</span>
                    </td>
                    {vendorData.map((v, colIdx) => {
                      const vItem = v.line_items[rowIdx] || {};
                      const hasMOQIssue = vItem.moq_required > item.quoted_qty;
                      return (
                        <td
                          key={colIdx}
                          onClick={() => setSelectedCell({ vendor: v.vendor_name, item: vItem })}
                          className={`p-3 cursor-pointer border-l border-slate-800 transition ${hasMOQIssue ? "bg-red-950/20" : "hover:bg-blue-950/40"}`}
                        >
                          <div className={`font-semibold ${hasMOQIssue ? "text-red-400" : "text-emerald-400"}`}>
                            ₹{vItem.normalized_price_inr?.toFixed(2) || "N/A"}
                          </div>
                          {hasMOQIssue && <div className="text-[10px] text-red-500 font-bold mt-1">MOQ: {vItem.moq_required}</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selectedCell && (
          <div className="mt-4 p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs">
            <span className="font-bold text-blue-400">{selectedCell.vendor} Audit Trace:</span>{" "}
            <span className="text-slate-300">{selectedCell.item?.audit_trail}</span>
          </div>
        )}
      </div>

      {/* RIGHT: Interrogation Copilot */}
      <div className="w-1/3 p-6 flex flex-col bg-slate-950/50">
        <div className="mb-4 flex justify-between items-center">
          <h2 className="text-lg font-bold text-white">AI Copilot</h2>
          <button 
            onClick={() => askCopilot("Draft a detailed Award Recommendation considering TCO, Risk Scorecard, and Shipping Lead Times. Use tables.")}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded transition font-medium"
          >
            Recommend Winner
          </button>
        </div>

        <div className="flex-1 overflow-auto space-y-4 mb-4 pr-1">
          {chatLog.map((msg, i) => (
            <div
              key={i}
              className={`p-4 rounded-lg text-sm ${
                msg.role === "user"
                  ? "bg-blue-600/20 border border-blue-500/30 text-blue-100 ml-4"
                  : "bg-slate-900 border border-slate-800 text-slate-200 mr-2 prose prose-invert prose-sm max-w-none"
              }`}
            >
              <div className="text-[10px] font-bold uppercase text-slate-500 mb-2 tracking-wider">
                {msg.role === "user" ? "Buyer" : "Aerchain Copilot"}
              </div>
              {msg.role === "user" ? (
                msg.text
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && askCopilot()}
            placeholder="Ask a follow-up question..."
          />
          <button
            onClick={() => askCopilot()}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            Ask
          </button>
        </div>
      </div>
    </div>
  );
}
