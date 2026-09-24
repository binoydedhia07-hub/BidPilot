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

    // 1. Direct match (e.g., pieces === pieces)
    if (qNorm === t) return { match: true, multiplier: 1 };

    // 2. Safe standard metric conversions
    if (qNorm === 'kg' && t === 'g') return { match: true, multiplier: 1000 };
    if (qNorm === 'g' && t === 'kg') return { match: true, multiplier: 0.001 };

    // 3. Fallback: Push to Blue "Unit Mismatch" state for Human Verification
    return { match: false, multiplier: 1 };
  };
  
  const getFxRate = (currency: string) => {
    const c = (currency || "INR").toUpperCase();
    if (c.includes("USD")) return 83.50;
    if (c.includes("EUR")) return 90.20;
    if (c.includes("GBP")) return 105.00;
    return 1.0;
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
      
      const fxRate = getFxRate(data.commercials?.currency);

      const isFuzzyMatch = (s1: string, s2: string) => {
        if (!s1 || !s2) return false;
        const n1 = s1.toLowerCase().replace(/[^a-z0-9]/g, '');
        const n2 = s2.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (n1 === n2 || n1.includes(n2) || n2.includes(n1)) return true;
        
        const words1 = s1.toLowerCase().match(/\b\w+\b/g) || [];
        const words2 = s2.toLowerCase().match(/\b\w+\b/g) || [];
        const overlap = words1.filter(w => words2.includes(w)).length;
        const threshold = Math.min(words1.length, words2.length) * 0.6; 
        return overlap >= threshold && overlap > 0;
      };

      data.line_items = (data.line_items || []).map((item: any) => {
        const desc = item.vendor_raw_description || item.description || "";
        const exactMatch = rfxBaseline.find(r => r.category.toLowerCase() === desc.toLowerCase());
        const aiMatch = rfxBaseline.find(r => r.category === item.master_item_category);
        const targetRfx = exactMatch || aiMatch;
        
        let semanticConfirmed = !!exactMatch || !!(targetRfx && isFuzzyMatch(desc, targetRfx.category)); 
        let hitlResolved = false;
        let conversionMultiplier = 1;
        let normalizedPrice = 0;

        if (semanticConfirmed && targetRfx) {
          const autoConv = attemptAutoConversion(item.quoted_uom, targetRfx.base_uom);
          if (autoConv.match) {
            hitlResolved = true;
            conversionMultiplier = autoConv.multiplier;
            normalizedPrice = ((Number(item.unit_price) || 0) * fxRate) / conversionMultiplier;
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

  const getAvailableItemsForVendor = (v: any) => {
    const occupiedItems = rfxBaseline.map(rfx => 
      v.line_items?.find((i: any) => i.master_item_category === rfx.category && !i.is_extra)
    ).filter(Boolean);
    return (v.line_items || []).filter((i: any) => !occupiedItems.includes(i));
  };

  const calculateVendorMath = (v: any) => {
    let subtotal = 0;
    rfxBaseline.forEach(rfx => {
      const vItem = v.line_items?.find((i: any) => i.master_item_category === rfx.category && !i.is_extra);
      if (vItem && vItem.normalized_price_inr && vItem.semantic_confirmed && vItem.hitl_resolved) {
        const moq = Number(vItem.moq_required) || 0;
        const actualQtyToBuy = Math.max(rfx.req_qty, moq);
        subtotal += vItem.normalized_price_inr * actualQtyToBuy;
      }
    });
    getAvailableItemsForVendor(v).forEach((i: any) => {
      if (i.normalized_price_inr && i.semantic_confirmed && i.hitl_resolved) {
         subtotal += i.normalized_price_inr * (Number(i.quoted_qty) || 1);
      }
    });

    const discountPct = Number(v.commercials?.immediate_discount_pct) || 0;
    const taxPct = Number(v.commercials?.tax_pct) || 0;
    const shippingFlat = Number(v.commercials?.shipping_cost_flat) || 0;

    const discountAmt = subtotal * (discountPct / 100);
    const afterDiscount = subtotal - discountAmt;
    const taxAmt = afterDiscount * (taxPct / 100);
    const landedCost = afterDiscount + taxAmt + shippingFlat;

    return { subtotal, discountPct, discountAmt, taxPct, taxAmt, shippingFlat, landedCost };
  };

  const askCopilot = async (displayMessage?: string, apiPrompt?: string) => {
    const uiText = displayMessage || question;
    const backendText = apiPrompt || displayMessage || question;
    if (!uiText.trim()) return;
    
    setChatLog((prev) => [...prev, { role: "user", text: uiText, apiText: backendText }]);
    setQuestion("");

    const enrichedContext = vendorData.map(v => {
      const math = calculateVendorMath(v);
      return {
        vendor_name: v.vendor_name,
        true_landed_cost_inr: math.landedCost,
        commercial_terms: v.commercials,
        vendor_scorecard: v.vendor_scorecard || { market_risk_rating: "3.5", compliance_score: 85, shipping_lead_time_days: 14 },
        line_items_analysis: (v.line_items || []).map((item: any) => {
          const rfx = rfxBaseline.find(r => r.category === item.master_item_category && !item.is_extra);
          const reqQty = rfx ? rfx.req_qty : (Number(item.quoted_qty) || 1);
          const moq = Number(item.moq_required) || 0;
          const actualQtyForcedToBuy = Math.max(reqQty, moq);
          return {
            category: item.master_item_category || item.vendor_raw_description,
            unit_price_inr: item.normalized_price_inr,
            rfx_requested_qty: reqQty,
            vendor_moq: moq,
            actual_qty_forced_to_buy: actualQtyForcedToBuy,
            moq_penalty_applied: moq > reqQty ? "YES - Cost heavily inflated due to MOQ" : "NO",
            total_line_cost_inr: (item.normalized_price_inr || 0) * actualQtyForcedToBuy
          };
        })
      };
    });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: backendText, context: enrichedContext, rfxBaseline, chatLog })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setChatLog((prev) => [...prev, { role: "assistant", text: data.text }]);
    } catch (err: any) {
      setChatLog((prev) => [...prev, { role: "assistant", text: `Error: ${err.message}` }]);
    }
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
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white font-medium px-4 py-2 rounded-lg transition shadow-sm text-sm whitespace-nowrap">
            {loading ? "Extracting..." : "+ Ingest Vendor Quote"}
            <input type="file" onChange={handleFileUpload} className="hidden" disabled={loading} />
          </label>
        </div>

        <div className="flex-1 overflow-auto bg-slate-950 rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm border-collapse min-w-max">
            <thead>
              <tr className="border-b-2 border-slate-700 bg-slate-900">
                <th className="p-4 min-w-[250px] max-w-[300px] align-top bg-slate-900 sticky left-0 z-20 shadow-[4px_0_12px_-4px_rgba(0,0,0,0.5)] border-r border-slate-800">
                  <div className="font-bold text-white mb-4">Requirement</div>
                  <div className="text-xs text-slate-500 uppercase tracking-wider">True Landed Cost</div>
                </th>
                {vendorData.map((v, i) => {
                  const math = calculateVendorMath(v);
                  const warranty = v.commercials?.warranty_terms || "None";
                  const currency = (v.commercials?.currency || "INR").toUpperCase();
                  const fxRate = getFxRate(currency);
                  
                  return (
                    <th key={i} className="p-4 font-normal text-xs align-top border-l border-slate-800 min-w-[320px] w-[320px]">
                      <div className="font-bold text-base text-white mb-1">{v.vendor_name}</div>
                      {currency !== "INR" && <div className="text-[10px] text-blue-400 mb-2">Quoted in {currency} (Est. 1 = ₹{fxRate.toFixed(2)})</div>}
                      
                      <div className="bg-slate-900 border border-slate-800 rounded p-3 mb-3 shadow-inner">
                        <div className="flex justify-between text-slate-400 mb-1"><span>Subtotal (MOQ Enforced):</span> <span>₹{math.subtotal.toFixed(2)}</span></div>
                        {math.discountPct > 0 && <div className="flex justify-between text-emerald-400 mb-1"><span>Discount ({math.discountPct}%):</span> <span>- ₹{math.discountAmt.toFixed(2)}</span></div>}
                        {math.taxPct > 0 && <div className="flex justify-between text-red-400 mb-1"><span>Tax ({math.taxPct}%):</span> <span>+ ₹{math.taxAmt.toFixed(2)}</span></div>}
                        {math.shippingFlat > 0 && <div className="flex justify-between text-red-400 mb-1"><span>Shipping:</span> <span>+ ₹{math.shippingFlat.toFixed(2)}</span></div>}
                        
                        <div className="border-t border-slate-700 mt-2 pt-2 flex justify-between font-bold text-lg text-emerald-400">
                          <span>Total INR:</span> <span>₹{math.landedCost.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 })}</span>
                        </div>
                      </div>

                      <div className="space-y-1 mb-2">
                        <div className={`text-[10px] p-2 rounded ${warranty !== "None" ? "bg-blue-900/30 text-blue-300 border border-blue-800" : "bg-slate-800 text-slate-500"}`}>
                          🛡️ Warranty: {warranty}
                        </div>
                        
                        {v.commercials?.conditional_notes?.map((note: string, idx: number) => (
                          <div key={idx} className="text-[10px] leading-tight text-amber-300 bg-amber-900/40 border border-amber-700/50 p-2 rounded">
                            ⚠️ {note}
                          </div>
                        ))}
                      </div>

                      <details className="mt-3 group">
                        <summary className="text-[11px] text-blue-400 cursor-pointer hover:text-blue-300 font-medium flex items-center justify-between bg-blue-900/20 p-2 rounded border border-blue-900/50 list-none [&::-webkit-details-marker]:hidden transition">
                          <span>📊 View Scorecard & Risk</span>
                          <span className="group-open:rotate-180 transition-transform">▼</span>
                        </summary>
                        <div className="mt-2 p-3 bg-slate-900/80 border border-slate-700/50 rounded space-y-2 text-[11px] shadow-inner">
                          <div className="flex justify-between border-b border-slate-700/50 pb-1">
                            <span className="text-slate-400">Risk Rating:</span>
                            <span className="text-white font-medium">{v.vendor_scorecard?.market_risk_rating || "3.5"}/5.0</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-700/50 pb-1">
                            <span className="text-slate-400">Compliance:</span>
                            <span className="text-white font-medium">{v.vendor_scorecard?.compliance_score || "85"}%</span>
                          </div>
                          <div className="flex justify-between pb-1">
                            <span className="text-slate-400">Lead Time:</span>
                            <span className="text-white font-medium">{v.vendor_scorecard?.shipping_lead_time_days || "14"} days</span>
                          </div>
                        </div>
                      </details>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rfxBaseline.map((rfxItem, rowIdx) => (
                <tr key={rowIdx} className="hover:bg-slate-900/50 transition h-28">
                  <td className="p-4 align-top bg-slate-950 sticky left-0 z-10 shadow-[4px_0_12px_-4px_rgba(0,0,0,0.5)] border-r border-slate-800">
                    <div className="font-medium text-slate-300">{rfxItem.category}</div>
                    <div className="text-xs text-slate-500 mt-1">RFx Target: {rfxItem.req_qty} {rfxItem.base_uom}</div>
                  </td>
                  
                  {vendorData.map((v, colIdx) => {
                    const vItem = v.line_items?.find((i: any) => i.master_item_category === rfxItem.category && !i.is_extra);

                    if (!vItem) {
                      const availableItems = getAvailableItemsForVendor(v);
                      return (
                        <td key={colIdx} className="p-0 border-l border-slate-800 align-top bg-red-950/10 min-w-[320px]">
                          <div className="p-4 h-full flex flex-col justify-start">
                            <div className="text-[10px] text-red-400 font-bold tracking-wider uppercase mb-2">❌ Missing</div>
                            <select 
                              className="w-full bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded p-2 outline-none focus:border-blue-500 cursor-pointer"
                              value=""
                              onChange={(e) => {
                                const desc = e.target.value;
                                if (!desc) return;
                                setVendorData(prev => prev.map((vend, id) => {
                                  if (id !== colIdx) return vend;
                                  const fxRate = getFxRate(vend.commercials?.currency);
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
                                          normalized_price_inr: autoConv.match ? (((Number(it.unit_price) || 0) * fxRate) / autoConv.multiplier) : 0
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

                    if (!vItem.semantic_confirmed) {
                      return (
                        <td key={colIdx} className="p-0 border-l border-slate-800 align-top bg-amber-950/20 min-w-[320px]">
                          <div className="p-4 h-full flex flex-col justify-start border-b-2 border-amber-500/50">
                            <div className="text-[10px] text-amber-500 font-bold tracking-wider uppercase mb-2">🔍 AI Suggestion</div>
                            <div className="text-xs text-white mb-3 leading-tight font-medium">"{vItem.vendor_raw_description}"</div>
                            <div className="flex gap-2 mt-auto">
                              <button 
                                onClick={() => setVendorData(prev => prev.map((vend, id) => {
                                  if (id !== colIdx) return vend;
                                  const fxRate = getFxRate(vend.commercials?.currency);
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
                                        normalized_price_inr: autoConv.match ? (((Number(it.unit_price) || 0) * fxRate) / autoConv.multiplier) : 0
                                      }
                                    })
                                  }
                                }))}
                                className="bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 hover:bg-emerald-600/40 text-xs px-3 py-2 rounded w-full transition">Confirm</button>
                              <button 
                                onClick={() => setVendorData(prev => prev.map((vend, id) => id !== colIdx ? vend : { ...vend, line_items: vend.line_items.map((it: any) => it === vItem ? { ...it, master_item_category: "", is_extra: true, semantic_confirmed: false } : it) }))}
                                className="bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 text-xs px-3 py-2 rounded w-full transition">Reject</button>
                            </div>
                          </div>
                        </td>
                      );
                    }

                    if (!vItem.hitl_resolved) {
                      return (
                        <td key={colIdx} className="p-0 border-l border-slate-800 align-top bg-blue-950/20 min-w-[320px]">
                          <div className="p-4 h-full flex flex-col justify-start border-b-2 border-blue-500/50">
                            <div className="text-[10px] text-blue-400 font-bold tracking-wider uppercase mb-1">⚖️ Unit Mismatch</div>
                            <div className="text-[10px] text-slate-400 mb-3">Vendor: <span className="text-slate-200 uppercase">{vItem.quoted_uom || "None"}</span> | Target: <span className="text-slate-200 uppercase">{rfxItem.base_uom}</span></div>
                            
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-[10px] text-slate-500 w-16">Multiplier:</span>
                              <input 
                                type="number" step="any" min="0.0001" 
                                className="bg-slate-950 border border-slate-700 text-white text-sm flex-1 p-1.5 rounded outline-none focus:border-blue-500" 
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
                                  const fxRate = getFxRate(vend.commercials?.currency);
                                  return {
                                    ...vend,
                                    line_items: vend.line_items.map((it: any) => {
                                      if (it !== vItem) return it;
                                      return { ...it, normalized_price_inr: ((Number(it.unit_price) || 0) * fxRate) / (it.conversion_multiplier || 1), hitl_resolved: true };
                                    })
                                  };
                                }));
                              }}
                              className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-2 rounded w-full mt-auto transition font-medium">
                              Apply & Recalculate
                            </button>
                          </div>
                        </td>
                      );
                    }

                    const hasMOQIssue = vItem.moq_required > rfxItem.req_qty;
                    return (
                      <td key={colIdx} className="p-0 border-l border-slate-800 align-top group relative min-w-[320px]">
                        <div className="p-4 h-full flex flex-col justify-start">
                          <button 
                            title="Unmap this item"
                            onClick={() => {
                              setVendorData(prev => prev.map((vend, id) => id !== colIdx ? vend : { ...vend, line_items: vend.line_items.map((it: any) => it === vItem ? { ...it, master_item_category: "", is_extra: true, semantic_confirmed: false, hitl_resolved: false } : it) }));
                            }}
                            className="absolute top-2 right-2 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition text-sm font-bold p-2">
                            ✕
                          </button>
                          <div className="text-xs text-slate-400 mb-1 leading-tight w-11/12 pr-4" title={vItem.vendor_raw_description}>
                            "{vItem.vendor_raw_description}"
                          </div>
                          <div className="font-semibold text-emerald-400 text-sm">
                            ₹{vItem.normalized_price_inr?.toFixed(2) || 0} <span className="text-[10px] text-slate-500 font-normal">/ {rfxItem.base_uom}</span>
                          </div>
                          {hasMOQIssue && <div className="text-[10px] text-red-500 font-bold mt-2 uppercase tracking-wider bg-red-950/40 p-1.5 rounded inline-block border border-red-900/50">⚠️ MOQ Failed: {vItem.moq_required} req</div>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              
              {getAllExtras().length > 0 && (
                <>
                  <tr className="bg-slate-900/80 border-t-4 border-slate-700">
                    <td className="p-4 align-top bg-slate-950 sticky left-0 z-10 shadow-[4px_0_12px_-4px_rgba(0,0,0,0.5)] border-r border-slate-800">
                       <span className="text-xs font-bold text-purple-400 uppercase tracking-wider">Additional Items</span>
                    </td>
                    <td colSpan={vendorData.length} className="p-4"></td>
                  </tr>
                  {getAllExtras().map((extraDesc, rowIdx) => (
                    <tr key={`extra-${rowIdx}`} className="hover:bg-slate-900/50 transition h-20 border-t border-slate-800/50">
                      <td className="p-4 align-top bg-slate-950 sticky left-0 z-10 shadow-[4px_0_12px_-4px_rgba(0,0,0,0.5)] border-r border-slate-800">
                        <div className="font-medium text-slate-400">{extraDesc}</div>
                        <div className="text-[10px] text-slate-600 mt-1 uppercase tracking-wider">Awaiting Assignment</div>
                      </td>
                      {vendorData.map((v, colIdx) => {
                        const availableItems = getAvailableItemsForVendor(v);
                        const vItem = availableItems.find((i: any) => i.vendor_raw_description === extraDesc);
                        
                        if (!vItem) return <td key={colIdx} className="p-4 border-l border-slate-800 min-w-[320px]" />;
                        return (
                          <td key={colIdx} className="p-4 border-l border-slate-800 align-top min-w-[320px]">
                            <div className="font-semibold text-purple-400 text-sm">
                              ₹{(Number(vItem.unit_price) * getFxRate(v.commercials?.currency)).toFixed(2)} <span className="text-[10px] text-slate-500 font-normal">/ {vItem.quoted_uom || "unit"}</span>
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
        </div>
      </div>

      <div className="w-1/3 p-6 flex flex-col bg-slate-950/50 border-l border-slate-800">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-white">BidPilot AI</h2>
          <p className="text-xs text-slate-400">Strict enterprise guardrails active</p>
        </div>
        <div className="flex-1 overflow-auto space-y-4 mb-4 pr-2">
          {chatLog.map((msg, i) => (
            <div key={i} className={`p-4 rounded-xl text-sm leading-relaxed ${msg.role === "user" ? "bg-blue-600/20 border border-blue-500/30 text-blue-100 ml-4" : "bg-slate-900 border border-slate-700 text-slate-200 mr-2 shadow-lg"}`}>
              <div className="text-[10px] font-bold uppercase text-slate-500 mb-2 tracking-wider">
                {msg.role === "user" ? "Buyer" : "BidPilot"}
              </div>
              {msg.role === "user" ? msg.text : <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>}
            </div>
          ))}
        </div>
        {vendorData.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            <button onClick={() => askCopilot("🏆 Recommend Winner", "Calculate the Holistic Recommendation. Consider True Landed Cost, MOQ Penalties, Scorecard risks, and conditional notes. DO NOT use tables. Use concise bullet points.")} className="text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-full transition border border-slate-600 shadow-sm">🏆 Recommend Winner</button>
            <button onClick={() => askCopilot("📦 Check Availability", "Which vendors are missing items from the RFx baseline? DO NOT use tables. Use text only.")} className="text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-full transition border border-slate-600 shadow-sm">📦 Check Availability</button>
          </div>
        )}
        <div className="flex gap-3">
          <input className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-sm text-slate-100 outline-none focus:border-blue-500 shadow-inner" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && askCopilot()} placeholder="Ask BidPilot..." />
          <button onClick={() => askCopilot()} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg text-sm font-bold transition shadow-md">Send</button>
        </div>
      </div>
    </div>
  );
}
