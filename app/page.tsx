"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function Dashboard() {
  const [vendorData, setVendorData] = useState<any[]>([]);
  const [chatLog, setChatLog] = useState<{ role: string; text: string; apiText?: string }[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);

  // --- THE RFX BASELINE (Source of Truth) ---
  const [rfxBaseline] = useState([
    { category: "Heavy 5-Ply Cartons Master", req_qty: 1000, base_uom: "pieces" },
    { category: "Standard 3-Ply Cartons", req_qty: 1000, base_uom: "pieces" },
    { category: "E-Commerce Die Cut Boxes", req_qty: 1000, base_uom: "pieces" },
    { category: "BOPP Packaging Tapes 65m", req_qty: 1000, base_uom: "rolls" },
    { category: "High Tensile Stretch Film 23mic", req_qty: 1000, base_uom: "kg" }
  ]);

  const normalizeUom = (u: string) => {
    const lower = (u || '').trim().toLowerCase();
    if (['pcs', 'piece', 'pieces', 'unit', 'units', 'each', 'nos', 'number', 'pp'].includes(lower)) return 'pieces';
    return lower;
  };

  const handleFileUpload = async (e: any) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("vendorName", `Vendor ${String.fromCharCode(65 + vendorData.length)}`);
    formData.append("rfxCategories", JSON.stringify(rfxBaseline.map(r => r.category)));

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
        body: JSON.stringify({ question: backendText, context: vendorData, rfxBaseline, chatLog })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setChatLog((prev) => [...prev, { role: "assistant", text: data.text }]);
    } catch (err: any) {
      setChatLog((prev) => [...prev, { role: "assistant", text: `Error: ${err.message}` }]);
    }
  };

  // Helper to dynamically calculate total based on RFx Required Quantity
  const calculateVendorTotal = (v: any) => {
    let total = 0;
    rfxBaseline.forEach(rfx => {
      const vItem = v.line_items?.find((i: any) => i.master_item_category === rfx.category);
      if (vItem && vItem.normalized_price_inr) {
        total += vItem.normalized_price_inr * rfx.req_qty;
      }
    });
    (v.line_items || []).forEach((i: any) => {
      if (i.is_extra && i.normalized_price_inr) {
         total += i.normalized_price_inr * (Number(i.quoted_qty) || 1);
      }
    });
    return total;
  };

  const getAllExtras = () => {
    const extras = new Set<string>();
    vendorData.forEach(v => {
      v.line_items?.forEach((i: any) => {
        if (i.is_extra) extras.add(i.vendor_raw_description);
      });
    });
    return Array.from(extras);
  };

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 font-sans overflow-hidden">
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

        {/* --- STATE-BASED HITL QUEUE --- */}
        {vendorData.length > 0 && vendorData.some(v => v.line_items?.some((i: any) => !i.hitl_resolved && (!rfxBaseline.find(r => r.category === i.master_item_category) || !i.semantic_confirmed || normalizeUom(i.quoted_uom) !== normalizeUom(rfxBaseline.find(r => r.category === i.master_item_category)?.base_uom || "")))) && (
          <div className="mb-6 bg-slate-950 border border-slate-800 rounded-xl p-4 shadow-lg">
            <h3 className="text-white font-bold text-sm mb-3 flex items-center">
              <span className="mr-2 text-blue-500">⚡</span> Action Required: Resolve Quote Ambiguities
            </h3>

            <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
              {vendorData.map((v, vIdx) => {
                return v.line_items?.map((item: any, iIdx: number) => {
                  if (item.hitl_resolved) return null;

                  const currentCat = item.master_item_category || "";
                  const rfxMatch = rfxBaseline.find(r => r.category === currentCat);
                  const isExactStringMatch = (item.vendor_raw_description || "").toLowerCase() === currentCat.toLowerCase();
                  
                  const itemUom = normalizeUom(item.quoted_uom);
                  const targetUom = rfxMatch ? normalizeUom(rfxMatch.base_uom) : "";

                  const isUnrecognized = !rfxMatch && !item.is_extra;
                  const isSemanticGuess = rfxMatch && !isExactStringMatch && !item.semantic_confirmed;
                  const isUomMismatch = rfxMatch && item.semantic_confirmed && itemUom !== targetUom;

                  if (rfxMatch && (isExactStringMatch || item.semantic_confirmed) && itemUom === targetUom && !item.hitl_resolved) {
                    setTimeout(() => {
                      setVendorData(prev => {
                        const newData = [...prev];
                        newData[vIdx].line_items[iIdx].hitl_resolved = true;
                        return newData;
                      });
                    }, 0);
                    return null;
                  }

                  if (isUnrecognized) {
                    return (
                      <div key={`${vIdx}-${iIdx}`} className="bg-slate-900 border border-purple-900/50 p-3 rounded-lg flex items-center justify-between text-sm">
                        <div className="flex-1 pr-4">
                          <span className="text-purple-400 font-bold text-xs uppercase tracking-wider block mb-1">[➕ Unrecognized Item]</span>
                          <span className="text-slate-400">{v.vendor_name} quoted </span>
                          <span className="text-white font-medium">"{item.vendor_raw_description}"</span>
                          <span className="text-slate-400"> which is not in the RFx.</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <select 
                            className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded px-3 py-2 outline-none focus:border-purple-500"
                            onChange={(e) => {
                              if (!e.target.value) return;
                              setVendorData(prev => {
                                const newData = [...prev];
                                newData[vIdx].line_items[iIdx].master_item_category = e.target.value;
                                newData[vIdx].line_items[iIdx].semantic_confirmed = true;
                                return newData;
                              });
                            }}
                          >
                            <option value="">Map to RFx Item...</option>
                            {rfxBaseline.map(r => <option key={r.category} value={r.category}>{r.category}</option>)}
                          </select>
                          <span className="text-slate-600 text-xs font-medium">OR</span>
                          <button 
                            onClick={() => {
                              setVendorData(prev => {
                                const newData = [...prev];
                                newData[vIdx].line_items[iIdx].is_extra = true;
                                newData[vIdx].line_items[iIdx].hitl_resolved = true;
                                return newData;
                              });
                            }}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-4 py-2 rounded transition border border-slate-700">
                            Add as Extra Item
                          </button>
                        </div>
                      </div>
                    );
                  }

                  if (isSemanticGuess) {
                    return (
                      <div key={`${vIdx}-${iIdx}`} className="bg-slate-900 border border-amber-900/50 p-3 rounded-lg flex items-center justify-between text-sm">
                        <div className="flex-1 pr-4">
                          <span className="text-amber-500 font-bold text-xs uppercase tracking-wider block mb-1">[🔍 AI Mapping Guess]</span>
                          <span className="text-slate-400">We mapped {v.vendor_name}'s </span>
                          <span className="text-white font-medium">"{item.vendor_raw_description}"</span>
                          <span className="text-slate-400"> to RFx item </span>
                          <span className="text-emerald-400 font-medium">"{rfxMatch.category}"</span>.
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              setVendorData(prev => {
                                const newData = [...prev];
                                newData[vIdx].line_items[iIdx].semantic_confirmed = true;
                                return newData;
                              });
                            }}
                            className="bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-600/30 text-xs px-4 py-2 rounded transition font-medium">
                            Yes, Confirm
                          </button>
                          <button 
                            onClick={() => {
                              setVendorData(prev => {
                                const newData = [...prev];
                                newData[vIdx].line_items[iIdx].master_item_category = "";
                                return newData;
                              });
                            }}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-4 py-2 rounded transition border border-slate-700">
                            No, Re-map
                          </button>
                        </div>
                      </div>
                    );
                  }

                  if (isUomMismatch) {
                    return (
                      <div key={`${vIdx}-${iIdx}`} className="bg-slate-900 border border-blue-900/50 p-3 rounded-lg flex items-center justify-between text-sm">
                        <div className="flex-1 pr-4">
                          <span className="text-blue-400 font-bold text-xs uppercase tracking-wider block mb-1">[⚖️ Unit Mismatch]</span>
                          <span className="text-slate-400">{v.vendor_name} quoted </span>
                          <span className="text-white font-medium uppercase">{item.quoted_uom || "MISSING UNIT"}</span>
                          <span className="text-slate-400">. RFx requires </span>
                          <span className="text-white font-medium uppercase">{rfxMatch.base_uom}</span>.
                        </div>
                        <div className="flex items-center gap-4 border-l border-slate-800 pl-4">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400">How many <span className="uppercase text-slate-200">{rfxMatch.base_uom}</span> in 1 <span className="uppercase text-slate-200">{item.quoted_uom || "unit"}</span>?</span>
                            <input 
                              type="number" min="0.0001" step="any"
                              className="bg-slate-950 border border-slate-700 rounded px-3 py-1.5 w-20 text-white outline-none focus:border-blue-500 text-sm"
                              value={item.conversion_multiplier || 1}
                              onChange={(e) => {
                                const newMultiplier = Number(e.target.value) || 1;
                                setVendorData(prev => {
                                  const newData = [...prev];
                                  newData[vIdx].line_items[iIdx].conversion_multiplier = newMultiplier;
                                  return newData;
                                });
                              }}
                            />
                          </div>
                          <button 
                            onClick={() => {
                              setVendorData(prev => {
                                const newData = [...prev];
                                const targetItem = newData[vIdx].line_items[iIdx];
                                const rawPrice = Number(targetItem.unit_price) || 0;
                                const freightStr = (newData[vIdx].commercials?.freight_terms || "").toLowerCase();
                                
                                let baseRate = rawPrice / (targetItem.conversion_multiplier || 1);
                                if (freightStr.includes("ex-works") || freightStr.includes("extra")) baseRate = baseRate * 1.025;
                                
                                targetItem.normalized_price_inr = baseRate;
                                targetItem.hitl_resolved = true;
                                return newData;
                              });
                            }}
                            className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-4 py-2 rounded transition font-medium">
                            Recalculate
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return null;
                });
              })}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto bg-slate-950 rounded-xl border border-slate-800 p-4">
          {vendorData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500">Upload a quote to populate the evaluation matrix.</div>
          ) : (
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-700 bg-slate-900">
                  <th className="p-3 w-1/4">Requirement</th>
                  {vendorData.map((v, i) => (
                    <th key={i} className="p-3 font-normal text-xs align-top border-l border-slate-800">
                      <div className="font-bold text-base text-white mb-1">{v.vendor_name}</div>
                      <div className="text-emerald-400 font-bold mb-3 text-lg">
                        ₹{calculateVendorTotal(v).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 })}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {rfxBaseline.map((rfxItem, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-slate-900/50 transition">
                    <td className="p-3 align-top">
                      <div className="font-medium text-slate-300">{rfxItem.category}</div>
                      <div className="text-xs text-slate-500 mt-1">RFx Target: {rfxItem.req_qty} {rfxItem.base_uom}</div>
                    </td>
                    {vendorData.map((v, colIdx) => {
                      const vItem = v.line_items?.find((i: any) => i.master_item_category === rfxItem.category);
                      
                      // RENDER INLINE MAPPING DROPDOWN FOR MISSING ITEMS
                      if (!vItem || !vItem.normalized_price_inr) {
                        const unmappedItems = v.line_items?.filter((i: any) => !i.master_item_category || i.is_extra) || [];
                        
                        return (
                          <td key={colIdx} className="p-3 border-l border-slate-800 align-top bg-red-950/10">
                            <div className="text-[10px] text-red-400 font-bold tracking-wider uppercase mb-2">
                              ❌ Missing
                            </div>
                            {unmappedItems.length > 0 && (
                              <select 
                                className="w-full bg-slate-900/80 border border-red-500/30 text-slate-300 text-[10px] rounded p-1.5 outline-none normal-case tracking-normal"
                                onChange={(e) => {
                                  const desc = e.target.value;
                                  if (!desc) return;
                                  setVendorData(prev => {
                                    const newData = [...prev];
                                    const targetLine = newData[colIdx].line_items.find((i: any) => i.vendor_raw_description === desc);
                                    if (targetLine) {
                                      targetLine.master_item_category = rfxItem.category;
                                      targetLine.is_extra = false;
                                      targetLine.semantic_confirmed = true;
                                      // Setting resolved to false forces it to the top queue if there's a unit mismatch!
                                      targetLine.hitl_resolved = false; 
                                    }
                                    return newData;
                                  });
                                }}
                              >
                                <option value="">Select from quote...</option>
                                {unmappedItems.map((ui: any, idx: number) => (
                                  <option key={idx} value={ui.vendor_raw_description}>{ui.vendor_raw_description}</option>
                                ))}
                              </select>
                            )}
                          </td>
                        );
                      }

                      const hasMOQIssue = vItem.moq_required > rfxItem.req_qty;

                      return (
                        <td key={colIdx} className="p-3 border-l border-slate-800 align-top">
                          <div className="text-[10px] text-slate-400 mb-1 leading-tight truncate w-40" title={vItem.vendor_raw_description}>
                            "{vItem.vendor_raw_description}"
                          </div>
                          <div className="font-semibold text-emerald-400">
                            ₹{vItem.normalized_price_inr.toFixed(2)} <span className="text-[10px] text-slate-500 font-normal">/ {rfxItem.base_uom}</span>
                          </div>
                          {hasMOQIssue && <div className="text-[10px] text-red-500 font-bold mt-1 uppercase tracking-wider">MOQ Failed: {vItem.moq_required} req</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                
                {getAllExtras().length > 0 && (
                  <>
                    <tr className="bg-slate-900/80">
                      <td colSpan={vendorData.length + 1} className="p-3 text-xs font-bold text-purple-400 uppercase tracking-wider border-t-2 border-slate-700">
                        Additional / Unrequested Items
                      </td>
                    </tr>
                    {getAllExtras().map((extraDesc, rowIdx) => (
                      <tr key={`extra-${rowIdx}`} className="hover:bg-slate-900/50 transition">
                        <td className="p-3 align-top">
                          <div className="font-medium text-slate-400">{extraDesc}</div>
                          <div className="text-xs text-slate-600 mt-1">Added by Vendor</div>
                        </td>
                        {vendorData.map((v, colIdx) => {
                          const vItem = v.line_items?.find((i: any) => i.vendor_raw_description === extraDesc && i.is_extra);
                          if (!vItem) return <td key={colIdx} className="p-3 border-l border-slate-800" />;
                          
                          return (
                            <td key={colIdx} className="p-3 border-l border-slate-800 align-top">
                              <div className="font-semibold text-purple-400">
                                ₹{Number(vItem.unit_price).toFixed(2)} <span className="text-[10px] text-slate-500 font-normal">/ {vItem.quoted_uom || "unit"}</span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </>
                )}
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
