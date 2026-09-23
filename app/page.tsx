"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function Dashboard() {
  const [vendorData, setVendorData] = useState<any[]>([]);
  const [chatLog, setChatLog] = useState<{ role: string; text: string; apiText?: string }[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);

  const [rfxBaseline] = useState([
    { category: "Heavy 5-Ply Cartons Master", req_qty: 1000, base_uom: "pieces" },
    { category: "Standard 3-Ply Cartons", req_qty: 1000, base_uom: "pieces" },
    { category: "E-Commerce Die Cut Boxes", req_qty: 1000, base_uom: "pieces" },
    { category: "BOPP Packaging Tapes 65m", req_qty: 1000, base_uom: "rolls" },
    { category: "High Tensile Stretch Film 23mic", req_qty: 1000, base_uom: "kg" }
  ]);

  const normalizeUom = (u: string) => {
    let lower = (u || '').trim().toLowerCase();
    if (['pcs', 'piece', 'pieces', 'unit', 'units', 'each', 'nos', 'number', 'pp'].includes(lower)) return 'pieces';
    if (['roll', 'rolls'].includes(lower)) return 'rolls';
    if (['kg', 'kgs', 'kilogram', 'kilograms'].includes(lower)) return 'kg';
    if (['g', 'gm', 'gms', 'gram', 'grams'].includes(lower)) return 'g';
    if (['box', 'boxes'].includes(lower)) return 'boxes';
    if (['carton', 'cartons'].includes(lower)) return 'cartons';
    return lower;
  };

  const attemptAutoConversion = (quoted: string, target: string) => {
    const q = (quoted || "").toLowerCase().trim();
    const t = normalizeUom(target);
    const qNorm = normalizeUom(q);

    if (qNorm === t) return { match: true, multiplier: 1 };
    
    const numMatch = q.match(/^([\d.,]+)\s*(.*)$/);
    if (numMatch) {
      const num = parseFloat(numMatch[1].replace(/,/g, ''));
      const text = normalizeUom(numMatch[2]);
      if (text === t) return { match: true, multiplier: num };
    }

    if (qNorm === 'kg' && t === 'g') return { match: true, multiplier: 1000 };
    if (qNorm === 'g' && t === 'kg') return { match: true, multiplier: 0.001 };

    return { match: false, multiplier: 1 };
  };

  const recalculateItemPrice = (item: any, vendor: any, multiplier: number) => {
    const rawPrice = Number(item.unit_price) || 0;
    const freightStr = (vendor.commercials?.freight_terms || "").toLowerCase();
    let baseRate = rawPrice / multiplier;
    if (freightStr.includes("ex-works") || freightStr.includes("extra")) baseRate *= 1.025;
    return baseRate;
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
      
      data.line_items = (data.line_items || []).map((item: any) => {
        const desc = item.vendor_raw_description || item.description || "";
        const exactMatch = rfxBaseline.find(r => r.category.toLowerCase() === desc.toLowerCase());
        const aiMatch = rfxBaseline.find(r => r.category === item.master_item_category);
        const targetRfx = exactMatch || aiMatch;
        
        let semanticConfirmed = !!exactMatch; 
        let hitlResolved = false;
        let conversionMultiplier = 1;
        let normalizedPrice = 0;

        if (semanticConfirmed && targetRfx) {
          const autoConv = attemptAutoConversion(item.quoted_uom, targetRfx.base_uom);
          if (autoConv.match) {
            hitlResolved = true;
            conversionMultiplier = autoConv.multiplier;
            normalizedPrice = recalculateItemPrice(item, data, conversionMultiplier);
          }
        }

        return {
          ...item,
          vendor_raw_description: desc,
          master_item_category: targetRfx ? targetRfx.category : "",
          semantic_confirmed: semanticConfirmed,
          hitl_resolved: hitlResolved,
          conversion_multiplier: conversionMultiplier,
          normalized_price_inr: normalizedPrice,
          is_extra: !targetRfx 
        };
      });

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

  // PURE FUNCTION: Finds items NOT actively locked in a row
  const getAvailableItemsForVendor = (v: any) => {
    const occupiedItems = rfxBaseline.map(rfx => 
      v.line_items?.find((i: any) => i.master_item_category === rfx.category && !i.is_extra)
    ).filter(Boolean);
    
    return (v.line_items || []).filter((i: any) => !occupiedItems.includes(i));
  };

  const calculateVendorTotal = (v: any) => {
    let total = 0;
    rfxBaseline.forEach(rfx => {
      const vItem = v.line_items?.find((i: any) => i.master_item_category === rfx.category && !i.is_extra);
      if (vItem && vItem.normalized_price_inr && vItem.semantic_confirmed && vItem.hitl_resolved) {
        total += vItem.normalized_price_inr * rfx.req_qty;
      }
    });
    getAvailableItemsForVendor(v).forEach((i: any) => {
      if (i.normalized_price_inr && i.semantic_confirmed && i.hitl_resolved) {
         total += i.normalized_price_inr * (Number(i.quoted_qty) || 1);
      }
    });
    return total;
  };

  const getAllExtras = () => {
    const extras = new Set<string>();
    vendorData.forEach(v => {
      getAvailableItemsForVendor(v).forEach((i: any) => extras.add(i.vendor_raw_description));
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

        <div className="flex-1 overflow-auto bg-slate-950 rounded-xl border border-slate-800 p-4">
          {vendorData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500">Upload a quote to populate the evaluation matrix.</div>
          ) : (
            <table className="w-full text-left text-sm border-collapse table-fixed">
              <thead>
                <tr className="border-b-2 border-slate-700 bg-slate-900">
                  <th className="p-3 w-1/4">Requirement</th>
                  {vendorData.map((v, i) => (
                    <th key={i} className="p-3 font-normal text-xs align-top border-l border-slate-800 w-1/3">
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
                  <tr key={rowIdx} className="hover:bg-slate-900/50 transition h-24">
                    <td className="p-3 align-top">
                      <div className="font-medium text-slate-300">{rfxItem.category}</div>
                      <div className="text-xs text-slate-500 mt-1">RFx Target: {rfxItem.req_qty} {rfxItem.base_uom}</div>
                    </td>
                    
                    {vendorData.map((v, colIdx) => {
                      const vItem = v.line_items?.find((i: any) => i.master_item_category === rfxItem.category && !i.is_extra);

                      // STATE 1: MISSING & MANUAL MAP
                      if (!vItem) {
                        const availableItems = getAvailableItemsForVendor(v);
                        return (
                          <td key={colIdx} className="p-0 border-l border-slate-800 align-top bg-red-950/10">
                            <div className="p-3 h-full flex flex-col justify-start">
                              <div className="text-[10px] text-red-400 font-bold tracking-wider uppercase mb-2">❌ Missing</div>
                              <select 
                                className="w-full bg-slate-900 border border-slate-700 text-slate-300 text-[10px] rounded p-1.5 outline-none focus:border-blue-500"
                                value=""
                                onChange={(e) => {
                                  const desc = e.target.value;
                                  if (!desc) return;
                                  setVendorData(prev => prev.map((vend, id) => {
                                    if (id !== colIdx) return vend;
                                    return {
                                      ...vend,
                                      line_items: vend.line_items.map((it: any) => {
                                        if (it.vendor_raw_description === desc) {
                                          const autoConv = attemptAutoConversion(it.quoted_uom, rfxItem.base_uom);
                                          return { 
                                            ...it, 
                                            master_item_category: rfxItem.category, 
                                            is_extra: false, 
                                            semantic_confirmed: true, 
                                            hitl_resolved: autoConv.match,
                                            conversion_multiplier: autoConv.multiplier,
                                            normalized_price_inr: autoConv.match ? recalculateItemPrice(it, vend, autoConv.multiplier) : 0
                                          };
                                        }
                                        return it;
                                      })
                                    };
                                  }));
                                }}
                              >
                                <option value="" disabled>Select from quote to map...</option>
                                {availableItems.map((ui: any, idx: number) => (
                                  <option key={idx} value={ui.vendor_raw_description}>{ui.vendor_raw_description} ({ui.quoted_uom || 'no unit'})</option>
                                ))}
                              </select>
                            </div>
                          </td>
                        );
                      }

                      // STATE 2: AI SEMANTIC GUESS PENDING
                      if (!vItem.semantic_confirmed) {
                        return (
                          <td key={colIdx} className="p-0 border-l border-slate-800 align-top bg-amber-950/20">
                            <div className="p-3 h-full flex flex-col justify-start border-b-2 border-amber-500/50">
                              <div className="text-[10px] text-amber-500 font-bold tracking-wider uppercase mb-2">🔍 AI Suggestion</div>
                              <div className="text-[11px] text-white mb-3 leading-tight font-medium">"{vItem.vendor_raw_description}"</div>
                              <div className="flex gap-2 mt-auto">
                                <button 
                                  onClick={() => setVendorData(prev => prev.map((vend, id) => {
                                    if (id !== colIdx) return vend;
                                    return {
                                      ...vend,
                                      line_items: vend.line_items.map((it: any) => {
                                        if (it !== vItem) return it;
                                        const autoConv = attemptAutoConversion(it.quoted_uom, rfxItem.base_uom);
                                        return {
                                          ...it,
                                          semantic_confirmed: true,
                                          hitl_resolved: autoConv.match,
                                          conversion_multiplier: autoConv.multiplier,
                                          normalized_price_inr: autoConv.match ? recalculateItemPrice(it, vend, autoConv.multiplier) : 0
                                        }
                                      })
                                    }
                                  }))}
                                  className="bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 hover:bg-emerald-600/40 text-[10px] px-2 py-1.5 rounded w-full transition">Confirm</button>
                                <button 
                                  onClick={() => setVendorData(prev => prev.map((vend, id) => id !== colIdx ? vend : { ...vend, line_items: vend.line_items.map((it: any) => it === vItem ? { ...it, master_item_category: "", is_extra: true, semantic_confirmed: false } : it) }))}
                                  className="bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 text-[10px] px-2 py-1.5 rounded w-full transition">Reject</button>
                              </div>
                            </div>
                          </td>
                        );
                      }

                      // STATE 3: UOM CONVERSION PENDING
                      if (!vItem.hitl_resolved) {
                        return (
                          <td key={colIdx} className="p-0 border-l border-slate-800 align-top bg-blue-950/20">
                            <div className="p-3 h-full flex flex-col justify-start border-b-2 border-blue-500/50">
                              <div className="text-[10px] text-blue-400 font-bold tracking-wider uppercase mb-1">⚖️ Unit Mismatch</div>
                              <div className="text-[9px] text-slate-400 mb-2">Vendor: <span className="text-slate-200 uppercase">{vItem.quoted_uom || "None"}</span> | Target: <span className="text-slate-200 uppercase">{rfxItem.base_uom}</span></div>
                              
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-[10px] text-slate-500 w-12">Multiplier:</span>
                                <input 
                                  type="number" step="any" min="0.0001" 
                                  className="bg-slate-950 border border-slate-700 text-white text-xs flex-1 p-1 rounded outline-none focus:border-blue-500" 
                                  value={vItem.conversion_multiplier || 1} 
                                  onChange={(e) => {
                                    const val = Number(e.target.value) || 1;
                                    setVendorData(prev => prev.map((vend, id) => id !== colIdx ? vend : { ...vend, line_items: vend.line_items.map((it: any) => it === vItem ? { ...it, conversion_multiplier: val } : it) }));
                                  }} 
                                />
                              </div>
                              <button 
                                onClick={() => {
                                  setVendorData(prev => prev.map((vend, id) => {
                                    if (id !== colIdx) return vend;
                                    return {
                                      ...vend,
                                      line_items: vend.line_items.map((it: any) => {
                                        if (it !== vItem) return it;
                                        return { ...it, normalized_price_inr: recalculateItemPrice(it, vend, it.conversion_multiplier || 1), hitl_resolved: true };
                                      })
                                    };
                                  }));
                                }}
                                className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] px-2 py-1.5 rounded w-full mt-auto transition">
                                Apply & Recalculate
                              </button>
                            </div>
                          </td>
                        );
                      }

                      // STATE 4: SUCCESS / RENDER DATA
                      const hasMOQIssue = vItem.moq_required > rfxItem.req_qty;
                      return (
                        <td key={colIdx} className="p-0 border-l border-slate-800 align-top group relative">
                          <div className="p-3 h-full flex flex-col justify-start">
                            <button 
                              title="Unmap this item"
                              onClick={() => {
                                setVendorData(prev => prev.map((vend, id) => id !== colIdx ? vend : { ...vend, line_items: vend.line_items.map((it: any) => it === vItem ? { ...it, master_item_category: "", is_extra: true, semantic_confirmed: false, hitl_resolved: false } : it) }));
                              }}
                              className="absolute top-2 right-2 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition text-xs font-bold">
                              ✕
                            </button>
                            <div className="text-[10px] text-slate-400 mb-1 leading-tight w-11/12 pr-4" title={vItem.vendor_raw_description}>
                              "{vItem.vendor_raw_description}"
                            </div>
                            <div className="font-semibold text-emerald-400">
                              ₹{vItem.normalized_price_inr?.toFixed(2) || 0} <span className="text-[10px] text-slate-500 font-normal">/ {rfxItem.base_uom}</span>
                            </div>
                            {hasMOQIssue && <div className="text-[10px] text-red-500 font-bold mt-2 uppercase tracking-wider">⚠️ MOQ Failed: {vItem.moq_required} req</div>}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                
                {/* RENDER EXTRAS & UNMAPPED AT BOTTOM */}
                {getAllExtras().length > 0 && (
                  <>
                    <tr className="bg-slate-900/80">
                      <td colSpan={vendorData.length + 1} className="p-3 text-xs font-bold text-purple-400 uppercase tracking-wider border-t-2 border-slate-700">
                        Unmapped & Additional Items
                      </td>
                    </tr>
                    {getAllExtras().map((extraDesc, rowIdx) => (
                      <tr key={`extra-${rowIdx}`} className="hover:bg-slate-900/50 transition h-20">
                        <td className="p-3 align-top">
                          <div className="font-medium text-slate-400">{extraDesc}</div>
                          <div className="text-[10px] text-slate-600 mt-1 uppercase tracking-wider">Awaiting Assignment</div>
                        </td>
                        {vendorData.map((v, colIdx) => {
                          const availableItems = getAvailableItemsForVendor(v);
                          const vItem = availableItems.find((i: any) => i.vendor_raw_description === extraDesc);
                          
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
        {vendorData.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            <button onClick={() => askCopilot("🏆 Recommend Winner", "Evaluate the vendors. Verify if all vendors quoted the complete list. Disqualify incomplete bids. Recommend winner on Total Cost.")} className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-full transition border border-slate-700">🏆 Recommend Winner</button>
            <button onClick={() => askCopilot("📦 Check Availability", "Which vendors are missing items from the RFx baseline?")} className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-full transition border border-slate-700">📦 Check Availability</button>
          </div>
        )}
        <div className="flex gap-2">
          <input className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && askCopilot()} placeholder="Ask BidPilot..." />
          <button onClick={() => askCopilot()} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition">Send</button>
        </div>
      </div>
    </div>
  );
}
