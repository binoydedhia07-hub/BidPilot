"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function Dashboard() {
  const [vendorData, setVendorData] = useState<any[]>([]);
  const [chatLog, setChatLog] = useState<{ role: string; text: string; apiText?: string }[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);

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

  const askCopilot = async (displayMessage?: string, apiPrompt?: string) => {
    const uiText = displayMessage || question;
    const backendText = apiPrompt || displayMessage || question;
    
    if (!uiText.trim()) return;
    
    setChatLog((prev) => [...prev, { role: "user", text: uiText, apiText: backendText }]);
    setQuestion("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: backendText, context: vendorData, chatLog })
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
            <h1 className="text-2xl font-bold text-white tracking-tight">BidPilot Enterprise</h1>
            <p className="text-sm text-slate-400">Intelligent RFx Normalization & Insights</p>
          </div>
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white font-medium px-4 py-2 rounded-lg transition shadow-sm text-sm">
            {loading ? "Extracting..." : "+ Ingest Vendor Quote"}
            <input type="file" onChange={handleFileUpload} className="hidden" disabled={loading} />
          </label>
        </div>

        {/* --- HITL TRUE NORMALIZATION & RESOLUTION QUEUE --- */}
        {vendorData.length > 0 && vendorData.some(v => 
          v.line_items?.some((item: any) => {
            const uom = (item.quoted_uom || "").trim().toLowerCase();
            const isMissingUnit = !uom || /^\d+$/.test(uom);
            const needsNormalization = isMissingUnit || !item.target_base_uom || uom !== item.target_base_uom.toLowerCase();
            return (needsNormalization || !item.master_item_category) && !item.hitl_resolved;
          })
        ) && (
          <div className="mb-6 bg-amber-950/40 border border-amber-800/50 rounded-xl p-4 shadow-lg">
            <h3 className="text-amber-500 font-bold text-sm mb-3 flex items-center">
              <span className="mr-2">⚠️</span> HITL Review: Normalize Units & Categories
            </h3>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
              {vendorData.map((v, vIdx) => 
                v.line_items?.map((item: any, iIdx: number) => {
                  const uom = (item.quoted_uom || "").trim().toLowerCase();
                  const isMissingUnit = !uom || /^\d+$/.test(uom);
                  const needsReview = (isMissingUnit || !item.target_base_uom || uom !== (item.target_base_uom || "").toLowerCase() || !item.master_item_category) && !item.hitl_resolved;
                  
                  if (!needsReview) return null;

                  return (
                    <div key={`${vIdx}-${iIdx}`} className="flex items-center justify-between text-xs bg-slate-900/60 p-3 rounded border border-amber-900/30">
                      <div className="w-1/4 text-slate-300 truncate pr-4">
                        <span className="font-bold text-white">{v.vendor_name}</span>
                        <br/>
                        <span className="text-slate-500" title={item.vendor_raw_description || item.description}>"{item.vendor_raw_description || item.description}"</span>
                      </div>
                      
                      <div className="flex-1 flex items-center gap-3">
                        <div>
                          <span className="text-slate-500 block text-[9px] uppercase tracking-wider mb-1">Master Category</span>
                          <input 
                            type="text" 
                            className="bg-slate-950 border border-amber-700/50 rounded px-2 py-1 w-32 text-white focus:border-amber-500 outline-none transition text-xs"
                            value={item.master_item_category || item.description || ""}
                            onChange={(e) => {
                              const newCat = e.target.value;
                              setVendorData((prev) => {
                                const newData = [...prev];
                                newData[vIdx].line_items[iIdx].master_item_category = newCat;
                                return newData;
                              });
                            }}
                          />
                        </div>

                        <div className="flex items-center gap-2 border-l border-amber-900/30 pl-3">
                          <div>
                            <span className="text-slate-500 block text-[9px] uppercase tracking-wider mb-1">Quoted UoM</span>
                            <span className={`px-2 py-1 rounded font-medium text-xs ${isMissingUnit ? 'bg-red-900/50 text-red-200 border border-red-500/50' : 'bg-slate-800 text-amber-200'}`}>
                              {isMissingUnit ? "MISSING" : item.quoted_uom}
                            </span>
                          </div>
                          
                          <div className="text-slate-500 mt-3">→</div>
                          
                          <div>
                            <span className="text-slate-500 block text-[9px] uppercase tracking-wider mb-1">Target Base Unit</span>
                            <input 
                              type="text" placeholder="e.g. g, pcs"
                              className="bg-slate-950 border border-amber-700/50 rounded px-2 py-1 w-20 text-white focus:border-amber-500 outline-none transition text-xs"
                              value={item.target_base_uom || ""}
                              onChange={(e) => {
                                setVendorData((prev) => {
                                  const newData = [...prev];
                                  newData[vIdx].line_items[iIdx].target_base_uom = e.target.value;
                                  return newData;
                                });
                              }}
                            />
                          </div>

                          <div className="text-slate-500 mt-3">×</div>

                          <div>
                            <span className="text-slate-500 block text-[9px] uppercase tracking-wider mb-1">Multiplier</span>
                            <input 
                              type="number" min="0.0001" step="any"
                              className="bg-slate-950 border border-amber-700/50 rounded px-2 py-1 w-16 text-white focus:border-amber-500 outline-none transition text-xs"
                              value={item.conversion_multiplier || 1}
                              onChange={(e) => {
                                const newMultiplier = Number(e.target.value) || 1;
                                setVendorData((prev) => {
                                  const newData = [...prev];
                                  const targetItem = newData[vIdx].line_items[iIdx];
                                  targetItem.conversion_multiplier = newMultiplier;
                                  
                                  const rawPrice = Number(targetItem.unit_price) || 0;
                                  const freightStr = (newData[vIdx].commercials?.freight_terms || "").toLowerCase();
                                  
                                  let baseRate = rawPrice / newMultiplier;
                                  if (freightStr.includes("ex-works") || freightStr.includes("extra")) {
                                    baseRate = baseRate * 1.025;
                                  }
                                  
                                  targetItem.normalized_price_inr = baseRate;
                                  targetItem.line_total_inr = baseRate * (Number(targetItem.quoted_qty) || 1);
                                  
                                  newData[vIdx].vendor_scorecard.total_landed_spend = newData[vIdx].line_items.reduce(
                                    (sum: number, it: any) => sum + (it.line_total_inr || 0), 0
                                  );
                                  return newData;
                                });
                              }}
                            />
                          </div>
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          setVendorData((prev) => {
                            const newData = [...prev];
                            newData[vIdx].line_items[iIdx].hitl_resolved = true;
                            return newData;
                          });
                        }}
                        className="text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 px-4 py-1.5 rounded transition border border-amber-500/20 ml-2">
                        Confirm 
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
        {/* ------------------------------------------- */}

        <div className="flex-1 overflow-auto bg-slate-950 rounded-xl border border-slate-800 p-4">
          {vendorData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500">Upload a quote to populate the evaluation matrix.</div>
          ) : (
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-700 bg-slate-900">
                  <th className="p-3 w-1/4">Master Category</th>
                  {vendorData.map((v, i) => (
                    <th key={i} className="p-3 font-normal text-xs align-top border-l border-slate-800">
                      <div className="font-bold text-base text-white mb-1">{v.vendor_name}</div>
                      <div className="text-emerald-400 font-bold mb-3 text-lg">
                        ₹{v.vendor_scorecard.total_landed_spend.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 })}
                      </div>
                      <div className="space-y-1 mb-3 border-b border-slate-800 pb-3">
                        {v.vendor_scorecard.commercial_insights?.map((insight: string, idx: number) => (
                          <div key={idx} className="text-[10px] leading-tight text-slate-300 bg-slate-800/50 p-1.5 rounded">{insight}</div>
                        ))}
                      </div>
                      <div className="text-slate-400 space-y-1 text-[11px]">
                        <div>Risk Rating: <span className="text-white">{v.vendor_scorecard.market_risk_rating}/5.0</span></div>
                        <div>Lead Time: <span className="text-white">{v.vendor_scorecard.shipping_lead_time_days} days</span></div>
                        <div>Compliance: <span className="text-white">{v.vendor_scorecard.compliance_score}%</span></div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {/* Dynamically extract all unique categories across all vendors */}
                {Array.from(new Set(
                  vendorData.flatMap(v => v.line_items?.map((i: any) => i.master_item_category || i.description) || [])
                )).filter(Boolean).map((categoryName: any, rowIdx: number) => {
                  
                  // Extract the general required quantity for this row (if available from any vendor)
                  const generalReqQty = vendorData.flatMap(v => v.line_items || []).find((i: any) => (i.master_item_category || i.description) === categoryName)?.quoted_qty || 0;

                  return (
                    <tr key={rowIdx} className="hover:bg-slate-900/50 transition">
                      <td className="p-3 font-medium text-slate-300 align-top">
                        {categoryName}
                        <span className="block text-xs text-slate-500 mt-1">Req Qty: {generalReqQty}</span>
                      </td>
                      {vendorData.map((v, colIdx) => {
                        // Find the exact item for this vendor based on the Master Category
                        const vItem = v.line_items?.find((i: any) => (i.master_item_category || i.description) === categoryName);
                        
                        if (!vItem || !vItem.normalized_price_inr) {
                          return (
                            <td key={colIdx} className="p-3 border-l border-slate-800 align-top">
                              <span className="text-xs text-slate-500 italic">No quote data</span>
                            </td>
                          );
                        }

                        const hasMOQIssue = vItem.moq_required > generalReqQty;

                        return (
                          <td key={colIdx} className="p-3 border-l border-slate-800 align-top">
                            <div className="text-[10px] text-slate-400 mb-1 leading-tight truncate w-40" title={vItem.vendor_raw_description || vItem.description}>
                              "{vItem.vendor_raw_description || vItem.description}"
                            </div>
                            <div className={`font-semibold ${hasMOQIssue ? "text-red-400" : "text-emerald-400"}`}>
                              ₹{vItem.normalized_price_inr.toFixed(2)} <span className="text-[10px] text-slate-500 font-normal">/ {vItem.target_base_uom || "unit"}</span>
                            </div>
                            {hasMOQIssue && <div className="text-[10px] text-red-500 font-bold mt-1 uppercase tracking-wider">MOQ Failed: {vItem.moq_required} req</div>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* RIGHT: BidPilot Interrogation */}
      <div className="w-1/3 p-6 flex flex-col bg-slate-950/50">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-white">BidPilot AI</h2>
          <p className="text-xs text-slate-400">Strict enterprise guardrails active</p>
        </div>

        <div className="flex-1 overflow-auto space-y-4 mb-4 pr-1">
          {chatLog.map((msg, i) => (
            <div key={i} className={`p-4 rounded-lg text-sm ${msg.role === "user" ? "bg-blue-600/20 border border-blue-500/30 text-blue-100 ml-4" : "bg-slate-900 border border-slate-800 text-slate-200 mr-2 prose prose-invert prose-sm max-w-none"}`}>
              <div className="text-[10px] font-bold uppercase text-slate-500 mb-2 tracking-wider">
                {msg.role === "user" ? "Buyer" : "BidPilot"}
              </div>
              {msg.role === "user" ? msg.text : <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>}
            </div>
          ))}
        </div>

        {/* Prompt Chips in Chat Area */}
        {vendorData.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            <button 
              onClick={() => askCopilot("🏆 Recommend Winner", "Evaluate the vendors. First, verify if all vendors quoted the complete list of required items. Disqualify any incomplete or anomalous bids. Then, recommend the valid winner based on Total Landed Cost.")} 
              className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-full transition border border-slate-700"
            >
              🏆 Recommend Winner
            </button>
            <button 
              onClick={() => askCopilot("⚠️ Analyze Risks", "Identify the biggest commercial risk among these vendors based on their lead times and payment terms. Keep it under 3 sentences.")} 
              className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-full transition border border-slate-700"
            >
              ⚠️ Analyze Risks
            </button>
          </div>
        )}

        <div className="flex gap-2">
          <input 
            className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500" 
            value={question} 
            onChange={(e) => setQuestion(e.target.value)} 
            onKeyDown={(e) => e.key === "Enter" && askCopilot()} 
            placeholder="Ask BidPilot..." 
          />
          <button 
            onClick={() => askCopilot()} 
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
