const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-Se6sZTtU.js","assets/path-CJbXD09f.js","assets/index-Dx4wHlxw.js","assets/index-DSYwAgMU.css"])))=>i.map(i=>d[i]);
import{c as Te,_ as ne,u as oe,j as s,s as U,r as A,I as De,a as he,b as Se,l as $e,d as Ie,e as Ge,f as Oe}from"./index-Dx4wHlxw.js";import{u as Le,o as qe}from"./useDropZone-Dvn1E4ZV.js";import{E as Ee}from"./exceljs.min-zZ1WqRFK.js";import{I as _e}from"./IconFileSpreadsheet-s_tISGOd.js";import{J as Me}from"./jszip.min-r3zvOO1K.js";import{L as Be}from"./LoadingOverlay-D2aiM0uX.js";import{H as Pe,Q as We}from"./HelpButton-CBj0mnqp.js";import"./_commonjs-dynamic-modules-TDtrdbi3.js";/**
 * @license @tabler/icons-react v3.44.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */const ke=[["path",{d:"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0",key:"svg-0"}],["path",{d:"M12 9h.01",key:"svg-1"}],["path",{d:"M11 12h1v4h1",key:"svg-2"}]],He=Te("outline","info-circle","InfoCircle",ke);async function we(e,r){const{readFile:n}=await ne(async()=>{const{readFile:t}=await import("./index-Se6sZTtU.js");return{readFile:t}},__vite__mapDeps([0,1,2,3])),l=await n(e),a=new Ee.Workbook;return await a.xlsx.load(l),{path:e,name:r,workbook:a}}function de(e){return e.worksheets.map(r=>r.name)}async function Ae(e,r){const n=await e.xlsx.writeBuffer(),{writeFile:l}=await ne(async()=>{const{writeFile:a}=await import("./index-Se6sZTtU.js");return{writeFile:a}},__vite__mapDeps([0,1,2,3]));await l(r,new Uint8Array(n))}function ze({file:e,sheetName:r,onFileChange:n,onSheetChange:l}){const{t:a}=oe(),t=e?de(e.workbook):[],m=async c=>{const i=c.find(v=>/\.(xlsx|xls)$/i.test(v));if(i)try{const v=i.split(/[/\\]/).pop()??i,f=await we(i,v);n(f);const S=de(f.workbook);l(S[0]??"")}catch(v){const f=v instanceof Error?v.message:String(v);U(a("qpcr.importFailed",{detail:f}),"error")}},{dropRef:o,isDragOver:u}=Le(m);async function g(){try{const c=await qe({multiple:!1,filters:[{name:"Excel",extensions:["xlsx","xls"]}]});if(!c)return;const i=Array.isArray(c)?c[0]:c,v=i.split(/[/\\]/).pop()??i,f=await we(i,v);n(f);const S=de(f.workbook);l(S[0]??"")}catch(c){const i=c instanceof Error?c.message:String(c);U(a("qpcr.openFailed",{detail:i}),"error")}}return s.jsxs(s.Fragment,{children:[s.jsxs("div",{ref:o,className:`file-display${u?" file-display--drag":""}`,children:[s.jsx("div",{className:"file-icon",style:{background:"#34c759"},children:s.jsx(_e,{size:20,color:"white",stroke:1.75})}),s.jsxs("div",{className:"file-info",children:[s.jsx("div",{className:"file-name",children:e?e.name:a("qpcr.noFileSelected")}),s.jsx("div",{className:"file-path",children:e?e.path:"xlsx / xls"})]}),u&&s.jsx("span",{className:"drop-hint",children:a("tiff.drop")})]}),s.jsxs("div",{className:"btn-row",children:[s.jsx("button",{className:"btn btn-primary",onClick:g,children:a("qpcr.open")}),e&&s.jsx("button",{className:"btn",style:{marginLeft:"auto",color:"var(--red)"},onClick:()=>{l(""),n(null)},children:a("qpcr.clear")})]}),e&&t.length>0&&s.jsxs("div",{className:"form-group",children:[s.jsx("label",{children:a("qpcr.sheet")}),s.jsx("select",{value:r,onChange:c=>l(c.target.value),children:t.map(c=>s.jsx("option",{value:c,children:c},c))})]})]})}const Ve=["Target","Gene","基因"],Xe=["Sample","Group","样本","分组"],Ue=["Cq","Ct"],ue={type:"pattern",pattern:"solid",fgColor:{argb:"FFFFFF00"}},Qe={bold:!0,name:"Times New Roman"},Re={identity:"DDEBF7",repeats:"BDD7EE"},Ye="EAF3FA";function Ke(e){let r=0;for(const n of e)r+=/[\u1100-\u115F\u2E80-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u3000-\u303F]/.test(n)?2:1;return r}function me(e,r){var n;for(let l=0;l<e.length;l++){const a=(n=e[l])==null?void 0:n.toString().trim().toLowerCase();if(a&&r.some(t=>t.toLowerCase()===a))return l}return-1}function pe(e){const r=e.getWorksheet("Transformed Data");if(!r)return[];const n=r.getRow(1),l=r.columnCount,a=[];for(let t=3;t<=l;t++){const m=String(n.getCell(t).value??"").trim();m&&a.push(m)}return a}function Je(e){const r=e.getWorksheet("Transformed Data");if(!r)return[];const n=[],l=new Set;for(let a=2;a<=r.rowCount;a++){const t=String(r.getRow(a).getCell(2).value??"").trim();t&&!l.has(t)&&(l.add(t),n.push(t))}return n}function Ze(e,r){var _;const n=e.getRow(1),l=e.columnCount,a=[];for(let d=1;d<=l;d++)a.push(String(n.getCell(d).value??""));let t=me(a,Ve),m=me(a,Xe),o=me(a,Ue);if(t===-1&&a.length>=6){const d=((_=a[2])==null?void 0:_.toLowerCase())??"";(d.includes("target")||d.includes("gene")||d.includes("基因"))&&(t=2,m=4,o=5)}if(t===-1)throw new Error("未找到 Target/Gene/基因 列");if(m===-1)throw new Error("未找到 Sample/Group/样本/分组 列");if(o===-1)throw new Error("未找到 Cq/Ct 列");const u=t+1,g=m+1,c=o+1,i=new Map,v=new Set,f=e.rowCount;for(let d=2;d<=f;d++){const F=e.getRow(d),y=String(F.getCell(u).value??"").trim(),N=String(F.getCell(g).value??"").trim(),D=F.getCell(c).value;if(!y||!N)continue;let L=null,b=!1;if(typeof D=="number")L=D;else{const P=parseFloat(String(D));isNaN(P)||D===""||D===null?b=!0:L=P}v.add(y),i.has(N)||i.set(N,new Map);const G=i.get(N);G.has(y)||G.set(y,[]),G.get(y).push({value:L,missing:b})}const S=Array.from(v),w=r.getWorksheet("Transformed Data");w&&r.removeWorksheet(w.id);const C=r.addWorksheet("Transformed Data"),R=["Num","Group"];for(const d of S)R.push(d);const $=C.getRow(1);for(let d=0;d<R.length;d++){const F=$.getCell(d+1);F.value=R[d],F.font=Qe,F.fill={type:"pattern",pattern:"solid",fgColor:{argb:d<2?Re.identity:Re.repeats}},F.border={bottom:{style:"medium",color:{argb:"FFB0B0B0"}}}}const h=Array.from(i.keys());let p=1;for(const d of h){const F=i.get(d),y=Math.max(...Array.from(F.values()).map(N=>N.length));for(let N=0;N<y;N++){p++;const D=C.getRow(p);D.getCell(1).value=p-1,D.getCell(2).value=d;for(let L=0;L<S.length;L++){const b=D.getCell(L+3),G=F.get(S[L]);if(!G||G.length===0){b.value=50,b.fill=ue;continue}const P=G.find(j=>!j.missing&&j.value!==null),O=G[N];O&&!O.missing&&O.value!==null?b.value=O.value:P?(b.value=P.value,b.fill=ue):(b.value=50,b.fill=ue)}}}return C.views=[{state:"frozen",xSplit:2,ySplit:1,topLeftCell:"C2"}],C.eachRow((d,F)=>{d.eachCell((y,N)=>{y.font={...y.font??{},name:"Times New Roman"},y.alignment={horizontal:"left"},F>1&&N===2&&(y.fill={type:"pattern",pattern:"solid",fgColor:{argb:Ye}})})}),C.columns.forEach((d,F)=>{let y=0;d.eachCell&&d.eachCell(N=>{const D=N.value?Ke(String(N.value)):10;D>y&&(y=D)}),d.width=y+(F<2?6:0)}),{geneNames:S}}function et({workbook:e,sheetName:r,onComplete:n,onProgress:l,onError:a}){const{t,language:m}=oe(),[o,u]=A.useState("ready"),[g,c]=A.useState(""),[i,v]=A.useState("");A.useEffect(()=>{u("ready"),c(""),v("")},[e]);const f=A.useMemo(()=>e?pe(e):[],[e]),S=f.length>0,w=S&&o==="ready",C=e&&r&&o!=="processing";async function R(){if(!(!e||!r))try{u("processing"),l==null||l(0,2,t("qpcr.transforming")),await new Promise(p=>requestAnimationFrame(()=>requestAnimationFrame(()=>p())));const $=e.getWorksheet(r);if(!$)throw new Error(t("qpcr.sheetNotFound"));const{geneNames:h}=Ze($,e);l==null||l(2,2,t("qpcr.done")),u("success"),v(`${t("qpcr.done")}，${h.length} ${t("qpcr.genes")}`),n(h)}catch($){a==null||a(),c($e($ instanceof Error?$.message:String($),m)),u("error")}}return s.jsxs(s.Fragment,{children:[s.jsxs("div",{className:"notice",children:[s.jsx(De,{size:14,stroke:1.75}),s.jsx("span",{children:t("qpcr.transformHint")})]}),w&&s.jsxs("div",{className:"result-success",children:[s.jsx(he,{size:14,stroke:1.75}),s.jsx("div",{children:t("qpcr.transformed",{count:f.length})})]}),s.jsx("button",{className:"btn btn-primary btn-full",onClick:R,disabled:!C,children:t(o==="processing"?"qpcr.executing":S?"qpcr.retransform":"qpcr.execute")}),o==="success"&&i&&s.jsxs("div",{className:"result-success",children:[s.jsx(he,{size:14,stroke:1.75}),s.jsx("div",{children:i})]}),o==="error"&&s.jsxs("div",{className:"result-success",style:{color:"var(--red)",background:"rgba(255,59,48,0.08)"},children:[s.jsx(Se,{size:14,stroke:1.75}),s.jsx("div",{children:g})]})]})}const ye=new Set(["Transformed Data","Summary_All_Genes","Summary_Best_Replicates","Summary_Outlier_Removed","Charts_All_Genes","Sheet1"]),ae={bold:!0,name:"Times New Roman"},fe={"ref-normalized":"相对内参","control-relative":"相对对照"},be={"ref-normalized":"Reference-normalized","control-relative":"Control-relative (ΔΔCt)"};function Z(e){if(e.length<=1)return 0;const r=e.reduce((l,a)=>l+a,0)/e.length,n=e.reduce((l,a)=>l+(a-r)**2,0)/(e.length-1);return Math.sqrt(n)}function tt(e,r){if(e===0)return e;if(!Number.isInteger(e)||e<2)throw new Error("择优重复数必须是 0（关闭）或大于等于 2 的整数");if(e>r)throw new Error(`择优重复数 ${e} 不能大于重复次数 ${r}`);return e}function rt(e){if(e===0)return e;if(!Number.isFinite(e)||e<=0)throw new Error("离群值剔除阈值必须是大于 0 的数（或 0 关闭）");return e}function at(e,r){const n=e.length;let l=[],a=1/0;const t=[],m=o=>{if(t.length===r){const u=Z(t.map(g=>e[g]));u<a&&(a=u,l=[...t]);return}for(let u=o;u<n;u++)t.push(u),m(u+1),t.pop()};return m(0),l}function J(e){if(e==null)return NaN;if(typeof e=="number")return e;const r=parseFloat(String(e).trim());return isNaN(r)?NaN:r}function st(e){if(!Number.isInteger(e)||e<1)throw new Error("重复次数必须是大于等于 1 的整数");return e}function lt(e,r){let n=1;for(let t=e.rowCount;t>=2;t--)if(String(e.getRow(t).getCell(2).value??"").trim()){n=t;break}const l=[];let a=2;for(;a<=n;){const t=String(e.getRow(a).getCell(2).value??"").trim();if(!t){a++;continue}const m=a;for(;a<=n&&String(e.getRow(a).getCell(2).value??"").trim()===t;)a++;const o=a-m;if(o!==r)throw new Error(`分组 "${t}" 从第 ${m} 行开始有 ${o} 个重复，但当前设置为 ${r} 个。请检查重复次数或 Transformed Data 数据。`);l.push({groupName:t,startRow:m,endRow:a})}return l}function se(e,r){const n=e.getRow(1);for(let l=1;l<=e.columnCount;l++)if(String(n.getCell(l).value??"").trim()===r)return l;throw new Error("Column "+r+" not found")}const Q={type:"pattern",pattern:"solid",fgColor:{argb:"FFFFFF00"}},nt="EAF3FA";function le(e){var n;const r=e.fill;return r!==void 0&&r.type==="pattern"&&r.pattern==="solid"&&(((n=r.fgColor)==null?void 0:n.argb)??"").toUpperCase()==="FFFFFF00"}function ot(e){let r=0;for(const n of e)r+=/[\u1100-\u115F\u2E80-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u3000-\u303F]/.test(n)?2:1;return r}const X={identity:"DDEBF7",repeats:"BDD7EE",stats:"E2EFDA",method:"FCE4D6",refCt:"FFF2CC",targetCt:"E4DFEC"};function xe(e,r,n){const l=[],a=[],t=(u,g)=>{l.push(u),a.push(g)};t("Gene",X.identity),t("Group_Name",X.identity);for(let u=1;u<=r;u++)t("Repeat"+u,X.repeats);t("Average",X.stats),t("Stdev",X.stats),t("Method",X.method);const m=l.length;for(let u=1;u<=r;u++)t(`${n}_Ct_R${u}`,X.refCt);for(let u=1;u<=r;u++)t(`Target_Ct_R${u}`,X.targetCt);const o=e.getRow(1);return l.forEach((u,g)=>{const c=o.getCell(g+1);c.value=u,c.font=ae,c.fill={type:"pattern",pattern:"solid",fgColor:{argb:a[g]}},c.border={bottom:{style:"medium",color:{argb:"FFB0B0B0"}}}}),e.views=[{state:"frozen",xSplit:2,ySplit:1,topLeftCell:"C2"}],m}function ve(e){e.eachRow((r,n)=>{r.eachCell((l,a)=>{l.font={...l.font??{},name:"Times New Roman"},l.alignment={horizontal:"left"},n>1&&(a===1||a===2)&&(l.fill={type:"pattern",pattern:"solid",fgColor:{argb:nt}})})}),e.columns.forEach((r,n)=>{let l=0;r.eachCell&&r.eachCell(a=>{const t=a.value?ot(String(a.value)):10;t>l&&(l=t)}),r.width=l+(n<2?6:0)})}function je(e,r,n){const l=[],a=[],t=[],m=[],o=[];let u=!0;for(let g=0;g<n;g++){const c=J(e.getCell(3+g).value),i=e.getCell(r+1+g),v=e.getCell(r+1+n+g),f=J(i.value),S=J(v.value);l.push(c),a.push(f),t.push(S),m.push(le(i)),o.push(le(v)),(isNaN(c)||isNaN(f)||isNaN(S))&&(u=!1)}return{geneName:String(e.getCell(1).value??"").trim(),groupName:String(e.getCell(2).value??""),repeats:l,refCts:a,targetCts:t,refFilled:m,targetFilled:o,methodNote:String(e.getCell(r).value??"").trim(),allValid:u}}function ct(e,r,n,l){if(r===0){const c=e.getWorksheet("Summary_Best_Replicates");c&&e.removeWorksheet(c.id);return}const a=e.getWorksheet("Summary_All_Genes");if(!a)return;let t=e.getWorksheet("Summary_Best_Replicates");if(!t)t=e.addWorksheet("Summary_Best_Replicates");else for(let c=t.rowCount;c>=1;c--)t.spliceRows(c,1);const m=xe(t,r,l);t.getCell("A1").note="QC reference only: each row keeps the K replicates with the lowest standard deviation. This understates variability and is not a standard statistical result — use Summary_All_Genes (all replicates) for reporting.";const o=se(a,"Method"),u=n;let g=2;for(let c=2;c<=a.rowCount;c++){const i=je(a.getRow(c),o,u);if(!i.geneName||!i.allValid)continue;const v=at(i.repeats,r);if(v.length!==r)continue;const f=t.getRow(g++);f.getCell(1).value=i.geneName,f.getCell(2).value=i.groupName;for(let R=0;R<v.length;R++)f.getCell(3+R).value=i.repeats[v[R]];const S=v.map(R=>i.repeats[R]),w=S.reduce((R,$)=>R+$,0)/S.length,C=Z(S);f.getCell(3+r).value=w,f.getCell(4+r).value=C,f.getCell(m).value=i.methodNote?`${i.methodNote} (Best-K subset)`:i.methodNote;for(let R=0;R<v.length;R++){const $=v[R],h=f.getCell(m+1+R);h.value=isNaN(i.refCts[$])?"N/A":i.refCts[$],i.refFilled[$]&&(h.fill=Q);const p=f.getCell(m+1+r+R);p.value=isNaN(i.targetCts[$])?"N/A":i.targetCts[$],i.targetFilled[$]&&(p.fill=Q)}}ve(t)}function it(e,r,n,l){if(r===0){const v=e.getWorksheet("Summary_Outlier_Removed");v&&e.removeWorksheet(v.id);return}const a=e.getWorksheet("Summary_All_Genes");if(!a)return;let t=e.getWorksheet("Summary_Outlier_Removed");if(!t)t=e.addWorksheet("Summary_Outlier_Removed");else for(let v=t.rowCount;v>=1;v--)t.spliceRows(v,1);const m=xe(t,n,l);t.getCell("A1").note=`Outlier removal: replicates deviating from the group mean by more than ${r}×SD (mean/SD recomputed after each removal) are excluded; the remaining replicates are reported. Removed replicate numbers are listed in the Removed column.`;const o=m+1+2*n,u=t.getCell(1,o);u.value="Removed",u.font=ae,u.fill={type:"pattern",pattern:"solid",fgColor:{argb:"F2F2F2"}},u.border={bottom:{style:"medium",color:{argb:"FFB0B0B0"}}};const g=se(a,"Method"),c=n;let i=2;for(let v=2;v<=a.rowCount;v++){const f=je(a.getRow(v),g,c);if(!f.geneName||!f.allValid)continue;const S=f.repeats.map((h,p)=>p),w=[];for(;S.length>1;){const h=S.map(y=>f.repeats[y]),p=h.reduce((y,N)=>y+N,0)/h.length,_=Z(h);if(!(_>0))break;let d=0,F=0;for(let y=0;y<S.length;y++){const N=Math.abs(f.repeats[S[y]]-p);N>F&&(F=N,d=y)}if(F>r*_)w.push(S[d]),S.splice(d,1);else break}w.sort((h,p)=>h-p);const C=t.getRow(i++);C.getCell(1).value=f.geneName,C.getCell(2).value=f.groupName;const R=new Set(S);for(let h=0;h<c;h++)R.has(h)&&(C.getCell(3+h).value=f.repeats[h]);const $=S.map(h=>f.repeats[h]);C.getCell(3+c).value=$.reduce((h,p)=>h+p,0)/$.length,C.getCell(4+c).value=Z($),C.getCell(m).value=f.methodNote?`${f.methodNote} (Outlier-removed: |Δ|>${r}×SD)`:f.methodNote;for(let h=0;h<c;h++){if(!R.has(h))continue;const p=C.getCell(m+1+h);p.value=isNaN(f.refCts[h])?"N/A":f.refCts[h],f.refFilled[h]&&(p.fill=Q);const _=C.getCell(m+1+c+h);_.value=isNaN(f.targetCts[h])?"N/A":f.targetCts[h],f.targetFilled[h]&&(_.fill=Q)}C.getCell(o).value=w.length>0?"R"+w.map(h=>h+1).join(", R"):"-"}ve(t)}function dt(e,r,n,l={}){r=st(r);const a=l.method??"ref-normalized",t=(l.controlGroup??"").trim();if(a==="control-relative"&&!t)throw new Error("相对对照方法需要指定对照组");const m=tt(l.selectNum??0,r),o=rt(l.outlierSd??0);if(m>=2&&o>0)throw new Error("择优重复数与离群值剔除不能同时启用，请只选一种");const u=e.getWorksheet("Transformed Data");if(!u)throw new Error("Transformed Data sheet not found");const g=u.columnCount,c=u.getRow(1),i=se(u,n),v=lt(u,r),f=[];for(let d=3;d<=g;d++){const F=String(c.getCell(d).value??"").trim();F&&F!==n&&f.push(F)}const S=e.worksheets.filter(d=>!ye.has(d.name));for(const d of S)e.removeWorksheet(d.id);let w=e.getWorksheet("Summary_All_Genes");if(!w)w=e.addWorksheet("Summary_All_Genes");else for(let d=w.rowCount;d>=1;d--)w.spliceRows(d,1);const C=be[a],R=a==="control-relative"?`${C} (control: ${t})`:C,$=a==="control-relative"?"Normalized Expression":"Relative Expression",h=xe(w,r,n);let p=2;const _=[];for(const d of f){const F=se(u,d);let y=d.length>31?d.substring(0,31):d;ye.has(y)&&(y+="_gene");let N=e.getWorksheet(y);if(!N)N=e.addWorksheet(y);else for(let j=N.rowCount;j>=1;j--)N.spliceRows(j,1);_.push(N);const D=[n,d,$,"Average","Stdev","Group_Name","Method"],L=N.getRow(1);D.forEach((j,x)=>{const E=L.getCell(x+1);E.value=j,E.font=ae});const b=new Map,G=[];for(const j of v){const{groupName:x,startRow:E,endRow:q}=j,z=[],V=[],ee=[],te=[],k=[];let M=!0;for(let B=0;B<q-E;B++){const W=E+B,T=u.getRow(W),H=T.getCell(F),Y=T.getCell(i),ce=J(H.value),ie=J(Y.value);z.push(ie),V.push(ce),ee.push(le(Y)),te.push(le(H)),!isNaN(ce)&&!isNaN(ie)?k.push(Math.pow(2,-(ce-ie))):M=!1}G.push({groupName:x,startRow:E,refVals:z,targetVals:V,refFilled:ee,targetFilled:te,rawRe:k,allValid:M})}let P=1;if(a==="control-relative"){const j=G.find(E=>E.groupName===t&&E.allValid&&E.rawRe.length===r);if(!j)throw new Error(`未找到对照组 "${t}" 的有效数据（基因 ${d}）`);const x=j.rawRe.reduce((E,q)=>E+q,0)/j.rawRe.length;if(!(x>0))throw new Error(`对照组 "${t}" 平均值无效（基因 ${d}）`);P=x}let O=2;for(const j of G){const{groupName:x,refVals:E,targetVals:q,refFilled:z,targetFilled:V,rawRe:ee,allValid:te}=j,k=[];for(let M=0;M<E.length;M++){const B=N.getRow(O+M);B.getCell(1).value=E[M],B.getCell(2).value=q[M],B.getCell(6).value=x,B.getCell(7).value=R;const W=E[M],T=q[M];if(!isNaN(T)&&!isNaN(W)){const H=Math.pow(2,-(T-W))/P;B.getCell(3).value=H,k.push(H)}else B.getCell(3).value="N/A"}if(te&&ee.length===r&&k.length===r){const M=k.reduce((T,H)=>T+H,0)/k.length,B=Z(k);N.getRow(O).getCell(4).value=M,N.getRow(O).getCell(5).value=B,b.set(x,{repeats:[...k],avg:M,stdev:B});const W=w.getRow(p++);W.getCell(1).value=d,W.getCell(2).value=x;for(let T=0;T<k.length;T++)W.getCell(3+T).value=k[T];W.getCell(3+r).value=M,W.getCell(4+r).value=B,W.getCell(h).value=R;for(let T=0;T<r;T++){const H=W.getCell(h+1+T);H.value=isNaN(E[T])?"N/A":E[T],z[T]&&(H.fill=Q);const Y=W.getCell(h+1+r+T);Y.value=isNaN(q[T])?"N/A":q[T],V[T]&&(Y.fill=Q)}}O+=E.length}if(b.size>0){const j=O+2,x=N.getRow(j);x.getCell(1).value="Group_Name",x.getCell(2).value="Average",x.getCell(3).value="Stdev",[1,2,3].forEach(q=>x.getCell(q).font=ae);let E=j+1;for(const[q,z]of b){const V=N.getRow(E++);V.getCell(1).value=q,V.getCell(2).value=z.avg,V.getCell(3).value=z.stdev}}}for(const d of _)d.eachRow(F=>{F.eachCell(y=>{y.font={...y.font??{},name:"Times New Roman"},y.alignment={horizontal:"left"}})});ve(w),ct(e,m,r,n),it(e,o,r,n)}const I={CHART:"http://schemas.openxmlformats.org/drawingml/2006/chart",DRAWING:"http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",A:"http://schemas.openxmlformats.org/drawingml/2006/main",R:"http://schemas.openxmlformats.org/officeDocument/2006/relationships",RELS:"http://schemas.openxmlformats.org/package/2006/relationships",CHART_REL:"http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",DRAWING_REL:"http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"},ut="application/vnd.openxmlformats-officedocument.drawingml.chart+xml",mt="application/vnd.openxmlformats-officedocument.drawing+xml",K="Charts_All_Genes";function ft(e,r,n){const l=(a,t)=>`<a:r>
      <a:rPr lang="en-US" sz="900" i="${t?1:0}">
        <a:latin typeface="Calibri"/>
      </a:rPr>
      <a:t>${ge(a)}</a:t>
    </a:r>`;return r==="control-relative"?l("Normalize to "+n+" (",!1)+l(e,!0)+l(")",!1):l("Normalize to ",!1)+l(e,!0)}function ge(e){return String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function ht(e){return e.length>31?e.substring(0,31):e}function gt(e,r,n,l,a,t="ref-normalized",m=""){const o=e.dataPoints,u=o.length,g=a>1,c=ge(ht(e.geneName)),i=ge(e.geneName),v=`'${i}'!$A$${r}:$A$${n}`,f=`'${i}'!$B$${r}:$B$${n}`,S=g?`'${i}'!$C$${r}:$C$${n}`:"",C=`<c:spPr>
      <a:solidFill><a:srgbClr val="${l.toString(16).padStart(6,"0").toUpperCase()}"/></a:solidFill>
      <a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
    </c:spPr>`,R=`<c:cat>
      <c:strRef>
        <c:f>${v}</c:f>
      </c:strRef>
    </c:cat>`,$=`<c:val>
      <c:numRef>
        <c:f>${f}</c:f>
        <c:numCache>
          <c:formatCode>General</c:formatCode>
          <c:ptCount val="${u}"/>
          ${o.map((p,_)=>`<c:pt idx="${_}"><c:v>${p.avg}</c:v></c:pt>`).join("")}
        </c:numCache>
      </c:numRef>
    </c:val>`;let h="";return g&&(h=`<c:errBars>
      <c:errDir val="y"/>
      <c:errBarType val="plus"/>
      <c:errValType val="cust"/>
      <c:noEndCap val="0"/>
      <c:spPr>
        <a:ln>
          <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
        </a:ln>
      </c:spPr>
      <c:plus>
        <c:numRef>
          <c:f>${S}</c:f>
          <c:numCache>
            <c:formatCode>General</c:formatCode>
            <c:ptCount val="${u}"/>
            ${o.map((p,_)=>`<c:pt idx="${_}"><c:v>${p.stdev}</c:v></c:pt>`).join("")}
          </c:numCache>
        </c:numRef>
      </c:plus>
      <c:minus>
        <c:numRef>
          <c:f>${S}</c:f>
          <c:numCache>
            <c:formatCode>General</c:formatCode>
            <c:ptCount val="${u}"/>
            ${o.map((p,_)=>`<c:pt idx="${_}"><c:v>${p.stdev}</c:v></c:pt>`).join("")}
          </c:numCache>
        </c:numRef>
      </c:minus>
    </c:errBars>`),`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace
  xmlns:c="${I.CHART}"
  xmlns:a="${I.A}"
  xmlns:r="${I.R}">
  <c:chart>
    <c:title>
      <c:tx>
        <c:rich>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr lang="en-US" sz="1500" b="1" i="1">
                <a:latin typeface="Calibri"/>
              </a:rPr>
              <a:t>${c}</a:t>
            </a:r>
          </a:p>
        </c:rich>
      </c:tx>
      <c:overlay val="0"/>
    </c:title>
    <c:autoTitleDeleted val="0"/>
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="clustered"/>
        <c:varyColors val="0"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          ${C}
          ${R}
          ${$}
          ${h}
        </c:ser>
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:barChart>
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:crossAx val="2"/>
        <c:crosses val="autoZero"/>
        <c:crossBetween val="between"/>
        <c:majorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
        <c:txPr>
          <a:bodyPr rot="-2700000"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr>
              <a:defRPr sz="800">
                <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
                <a:latin typeface="Calibri"/>
              </a:defRPr>
            </a:pPr>
            <a:endParaRPr/>
          </a:p>
        </c:txPr>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:crossAx val="1"/>
        <c:crosses val="min"/>
        <c:crossBetween val="between"/>
        <c:title>
        <c:tx>
          <c:rich>
            <a:bodyPr/>
            <a:lstStyle/>
            <a:p>
              ${ft(e.refGene,t,m)}
              </a:p>
            </c:rich>
          </c:tx>
          <c:overlay val="0"/>
        </c:title>
        <c:txPr>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:pPr>
              <a:defRPr sz="800">
                <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
                <a:latin typeface="Calibri"/>
              </a:defRPr>
            </a:pPr>
            <a:endParaRPr/>
          </a:p>
        </c:txPr>
      </c:valAx>
    </c:plotArea>
    <c:plotVisOnly val="1"/>
  </c:chart>
</c:chartSpace>`}function pt(e){return`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr
  xmlns:xdr="${I.DRAWING}"
  xmlns:a="${I.A}"
  xmlns:r="${I.R}"
  xmlns:c="${I.CHART}">
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from>
      <xdr:col>0</xdr:col>
      <xdr:colOff>95250</xdr:colOff>
      <xdr:row>0</xdr:row>
      <xdr:rowOff>190500</xdr:rowOff>
    </xdr:from>
    <xdr:to>
      <xdr:col>6</xdr:col>
      <xdr:colOff>0</xdr:colOff>
      <xdr:row>14</xdr:row>
      <xdr:rowOff>0</xdr:rowOff>
    </xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="2" name="Chart 1"/>
        <xdr:cNvGraphicFramePr>
          <a:graphicFrameLocks noGrp="1"/>
        </xdr:cNvGraphicFramePr>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm>
        <a:off x="95250" y="190500"/>
        <a:ext cx="3810000" cy="2857500"/>
      </xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="${I.CHART}">
          <c:chart r:id="${e}"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`}function re(e){const r=e.map(n=>`    <Relationship Id="${n.Id}" Type="${n.Type}" Target="${n.Target}"/>`);return`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${I.RELS}">
${r.join(`
`)}
</Relationships>`}function xt(e){const n=[];for(let l=0;l<e;l++){const a=l*16,t=a+14,m=190500+l*16*190500;n.push(`  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from>
      <xdr:col>0</xdr:col>
      <xdr:colOff>95250</xdr:colOff>
      <xdr:row>${a}</xdr:row>
      <xdr:rowOff>190500</xdr:rowOff>
    </xdr:from>
    <xdr:to>
      <xdr:col>6</xdr:col>
      <xdr:colOff>0</xdr:colOff>
      <xdr:row>${t}</xdr:row>
      <xdr:rowOff>0</xdr:rowOff>
    </xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="${l+2}" name="Chart ${l+1}"/>
        <xdr:cNvGraphicFramePr>
          <a:graphicFrameLocks noGrp="1"/>
        </xdr:cNvGraphicFramePr>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm>
        <a:off x="95250" y="${m}"/>
        <a:ext cx="3810000" cy="2857500"/>
      </xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="${I.CHART}">
          <c:chart r:id="rId${l+1}"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>`)}return`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr
  xmlns:xdr="${I.DRAWING}"
  xmlns:a="${I.A}"
  xmlns:r="${I.R}"
  xmlns:c="${I.CHART}">
${n.join(`
`)}
</xdr:wsDr>`}function vt(){return`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${I.RELS}">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../theme/theme1.xml"/>
</Relationships>`}function Ct(e){return`<Override PartName="${e}" ContentType="${ut}"/>`}function Fe(e){return`<Override PartName="${e}" ContentType="${mt}"/>`}async function wt(e){var t;const r=new Map,n=await((t=e.file("xl/workbook.xml"))==null?void 0:t.async("string"));if(!n)return r;const l=/<sheet[^>]*?\bname\s*=\s*"([^"]*)"[^>]*?\bsheetId\s*=\s*"(\d+)"|<sheet[^>]*?\bsheetId\s*=\s*"(\d+)"[^>]*?\bname\s*=\s*"([^"]*)"/gi;let a;for(;(a=l.exec(n))!==null;){const m=a[1]||a[4],o=parseInt(a[2]||a[3],10);m&&!isNaN(o)&&r.set(m,o)}return r}function Ne(e){const r=/Id="rId(\d+)"/g;let n=0,l;for(;(l=r.exec(e))!==null;){const a=parseInt(l[1],10);a>n&&(n=a)}return n}async function Rt(e,r){const{sheets:n,repeatCount:l,colorRGB:a=5210557,method:t="ref-normalized",controlGroup:m=""}=r;if(n.length===0)return e;const o=await Me.loadAsync(e),u=await wt(o);let g=0;const c=[];for(const w of n){g++;const C=u.get(w.geneName);if(!C)continue;c.push(w);const R=`xl/worksheets/sheet${C}.xml`,$=`xl/worksheets/_rels/sheet${C}.xml.rels`,h=w.groupHeaderRow+1,p=w.groupHeaderRow+w.dataPoints.length,_=gt(w,h,p,a,l,t,m);o.file(`xl/charts/chart${g}.xml`,_);const d=vt();o.file(`xl/charts/_rels/chart${g}.xml.rels`,d);const F=`rId${g}`,y=pt(F);o.file(`xl/drawings/drawing${g}.xml`,y);const N=re([{Id:F,Type:I.CHART_REL,Target:`../charts/chart${g}.xml`}]);o.file(`xl/drawings/_rels/drawing${g}.xml.rels`,N);const D=o.file(R);if(!D)continue;const L=await D.async("string");let b=L;if(!L.includes("<drawing")){const G=`rId${g+100}`;b=L.replace("</worksheet>",`  <drawing r:id="${G}"/>
</worksheet>`);const P=o.file($);if(P){let O=await P.async("string");if(!O.includes(I.DRAWING_REL)){const x=`rId${Ne(O)+1}`;O=O.replace("</Relationships>",`  <Relationship Id="${x}" Type="${I.DRAWING_REL}" Target="../drawings/drawing${g}.xml"/>
</Relationships>`),o.file($,O)}}else{const O=re([{Id:G,Type:I.DRAWING_REL,Target:`../drawings/drawing${g}.xml`}]);o.file($,O)}}o.file(R,b)}let i=0;const v=u.get(K);if(v!==void 0&&c.length>0){const w=`xl/worksheets/sheet${v}.xml`,C=o.file(w);if(C){const R=await C.async("string");i=g+1;const $=`xl/drawings/drawing${i}.xml`;o.file($,xt(c.length));const h=c.map((p,_)=>({Id:`rId${_+1}`,Type:I.CHART_REL,Target:`../charts/chart${_+1}.xml`}));if(o.file(`xl/drawings/_rels/drawing${i}.xml.rels`,re(h)),!R.includes("<drawing")){const p=`xl/worksheets/_rels/sheet${v}.xml.rels`,_=o.file(p);let d;if(_){const F=await _.async("string"),y=Ne(F)+1;o.file(p,F.replace("</Relationships>",`  <Relationship Id="rId${y}" Type="${I.DRAWING_REL}" Target="../drawings/drawing${i}.xml"/>
</Relationships>`)),d=R.replace("</worksheet>",`  <drawing r:id="rId${y}"/>
</worksheet>`)}else o.file(p,re([{Id:"rId1",Type:I.DRAWING_REL,Target:`../drawings/drawing${i}.xml`}])),d=R.replace("</worksheet>",`  <drawing r:id="rId1"/>
</worksheet>`);o.file(w,d)}}}const f=o.file("[Content_Types].xml");if(f){let w=await f.async("string");for(let C=1;C<=g;C++){const R=Ct(`/xl/charts/chart${C}.xml`),$=Fe(`/xl/drawings/drawing${C}.xml`);w.includes(`chart${C}.xml`)||(w=w.replace("</Types>",`  ${R}
  ${$}
</Types>`))}if(i>0){const C=Fe(`/xl/drawings/drawing${i}.xml`);w.includes(`drawing${i}.xml`)||(w=w.replace("</Types>",`  ${C}
</Types>`))}o.file("[Content_Types].xml",w)}return await o.generateAsync({type:"uint8array",compression:"DEFLATE",compressionOptions:{level:6}})}const Ce="#3C9FDF",yt=new Set(["Transformed Data","Summary_All_Genes","Summary_Best_Replicates","Summary_Outlier_Removed","Charts_All_Genes","Sheet1"]);function Ft(e){if(typeof e!="string")return 3973087;const r=e.trim().match(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);if(!r)return 3973087;const n=r[1].slice(0,6),l=parseInt(n,16);return Number.isFinite(l)?l:3973087}function Nt(e,r){const n=[];let l=0;for(const a of e.worksheets){if(yt.has(a.name))continue;l++;const t=a.name;let m=0;const o=a.rowCount;for(let c=1;c<=o;c++){const i=a.getRow(c).getCell(1);if(String(i.value??"").trim()==="Group_Name"){m=c;break}}if(m===0)continue;const u=[];for(let c=m+1;c<=o;c++){const i=String(a.getRow(c).getCell(1).value??"").trim(),v=parseFloat(String(a.getRow(c).getCell(2).value??""));if(!i||isNaN(v))break;const f=r>1?parseFloat(String(a.getRow(c).getCell(3).value??"")):0;u.push({name:i,avg:v,stdev:isNaN(f)?0:f})}if(u.length===0)continue;const g=String(a.getRow(1).getCell(1).value??"Ref Gene").trim();n.push({sheetIndex:l,geneName:t,refGene:g,dataPoints:u,groupHeaderRow:m})}return n}async function St(e,r,n,l=Ce,a,t={}){try{const m=Nt(e,n);if(m.length===0)return{success:!1,reason:"未找到可生成图表的基因数据（没有找到 Group_Name 汇总表）"};const o=e.getWorksheet(K);o&&e.removeWorksheet(o.id),e.addWorksheet(K);const g=e.worksheets.map(C=>C.name).filter(C=>C!==K),c=g.indexOf("Summary_All_Genes");c!==-1&&g.splice(c+1,0,K),g.forEach((C,R)=>{const $=e.getWorksheet(C);$&&($.orderNo=R+1)}),a==null||a(0,m.length),await Ae(e,r);const{readFile:i,writeFile:v}=await ne(async()=>{const{readFile:C,writeFile:R}=await import("./index-Se6sZTtU.js");return{readFile:C,writeFile:R}},__vite__mapDeps([0,1,2,3])),f=await i(r),S=Ft(l),w=await Rt(f,{sheets:m,repeatCount:n,colorRGB:S,method:t.method,controlGroup:t.controlGroup});return await v(r,w),a==null||a(m.length,m.length),{success:!0,chartsCreated:m.length}}catch(m){return{success:!1,reason:m instanceof Error?m.message:String(m)}}}async function $t(e,r,n=Ce,l,a={}){try{const{readFile:t}=await ne(async()=>{const{readFile:u}=await import("./index-Se6sZTtU.js");return{readFile:u}},__vite__mapDeps([0,1,2,3])),m=await t(e),o=new Ee.Workbook;return await o.xlsx.load(m),await St(o,e,r,n,l,a)}catch(t){return{success:!1,reason:t instanceof Error?t.message:String(t)}}}function Et({workbook:e,geneNames:r,onComplete:n,onProgress:l,onError:a}){const{t,language:m}=oe(),[o,u]=A.useState(2),[g,c]=A.useState("0"),[i,v]=A.useState("ref-normalized"),[f,S]=A.useState(""),[w,C]=A.useState(""),[R,$]=A.useState(Ce),[h,p]=A.useState("ready"),[_,d]=A.useState(""),[F,y]=A.useState("");A.useEffect(()=>{let x=!1;return Ie().then(E=>{x||$(E)}),()=>{x=!0}},[]),A.useEffect(()=>{p("ready"),d(""),y("")},[e]);const N=A.useMemo(()=>r.length>0?r:e?pe(e):[],[r,e]),D=A.useMemo(()=>e?Je(e):[],[e,r]),L=w||N[0]||"",b=f||D[0]||"",G=i==="control-relative",P=e!==null&&L!==""&&h!=="processing"&&(!G||b!=="");async function O(){if(!(!e||!L)&&!(G&&!b))try{p("processing"),d(""),l==null||l(0,2,t("qpcr.calculating")),await new Promise(z=>requestAnimationFrame(()=>requestAnimationFrame(()=>z())));let x=0,E=0;g.startsWith("best:")?x=Number(g.slice(5)):g.startsWith("outlier:")&&(E=Number(g.slice(8))),dt(e,o,L,{method:i,controlGroup:G?b:void 0,selectNum:x,outlierSd:E}),l==null||l(2,2,t("qpcr.calculated")),p("success");const q=m==="en"?be[i]:fe[i];y(`${t("qpcr.calculated")}（${q}），${N.length} ${t("qpcr.genes")}`),n(o,R,{method:i,controlGroup:G?b:void 0})}catch(x){a==null||a(),p("error"),d($e(x instanceof Error?x.message:t("qpcr.processingError"),m))}}if(!e)return s.jsx("div",{style:{fontSize:12,color:"var(--text-tertiary)",padding:"4px 0"},children:t("qpcr.noFile")});const j=N.length>0;return s.jsxs(s.Fragment,{children:[s.jsxs("div",{className:"form-row",children:[s.jsxs("div",{className:"form-group",children:[s.jsx("label",{children:t("qpcr.method")}),s.jsxs("select",{value:i,onChange:x=>v(x.target.value),disabled:h==="processing",children:[s.jsxs("option",{value:"ref-normalized",children:[fe["ref-normalized"],"（",t("qpcr.default"),"）"]}),s.jsxs("option",{value:"control-relative",children:[fe["control-relative"],"（ΔΔCt）"]})]})]}),G&&s.jsxs("div",{className:"form-group",children:[s.jsx("label",{children:t("qpcr.controlGroup")}),s.jsx("select",{value:b,onChange:x=>S(x.target.value),disabled:h==="processing"||D.length===0,children:D.length>0?D.map(x=>s.jsx("option",{value:x,children:x},x)):s.jsx("option",{value:"",children:t("qpcr.transformFirst")})})]})]}),s.jsxs("div",{className:"form-row form-row--three",children:[s.jsxs("div",{className:"form-group",children:[s.jsx("label",{children:t("qpcr.repeats")}),s.jsx("select",{value:o,onChange:x=>{const E=Number(x.target.value);u(E),g.startsWith("best:")&&Number(g.slice(5))>E&&c(`best:${E}`)},disabled:h==="processing",children:Array.from({length:12},(x,E)=>E+1).map(x=>s.jsx("option",{value:x,children:x},x))})]}),s.jsxs("div",{className:"form-group",children:[s.jsx("label",{children:t("qpcr.referenceGene")}),s.jsx("select",{value:L,onChange:x=>C(x.target.value),disabled:h==="processing"||!j,children:j?N.map(x=>s.jsx("option",{value:x,children:x},x)):s.jsx("option",{value:"",children:t("qpcr.transformFirst")})})]}),s.jsxs("div",{className:"form-group",children:[s.jsx("label",{children:t("qpcr.chartColor")}),s.jsxs("div",{className:"color-picker-row",children:[s.jsx("input",{type:"color",value:R,disabled:h==="processing",onChange:x=>{const E=x.target.value;$(E),Ge(E).catch(()=>{})},"aria-label":t("qpcr.chartColor")}),s.jsx("span",{className:"color-hex",children:R.toUpperCase()})]})]})]}),s.jsx("div",{className:"form-row",children:s.jsxs("div",{className:"form-group",children:[s.jsxs("label",{children:[t("qpcr.replicateHandling"),s.jsx("span",{title:"重复处理：① 择优重复数 — 为每个样本挑选标准差最低的 K 个重复，生成 Summary_Best_Replicates（仅作内部 QC 参考，正式报告请用全部重复的 Summary_All_Genes）；② 离群值剔除 — 迭代剔除偏离组均值超过 K×SD 的重复，生成 Summary_Outlier_Removed（规则客观，可在方法学中披露）；选 0 关闭",style:{cursor:"help",marginLeft:4,verticalAlign:"middle"},children:s.jsx(He,{size:14,stroke:1.75,style:{color:"var(--text-tertiary)"}})})]}),s.jsxs("select",{value:g,onChange:x=>c(x.target.value),disabled:h==="processing",children:[s.jsxs("option",{value:"0",children:["0 — ",t("qpcr.disabled")]}),s.jsx("optgroup",{label:t("qpcr.bestReplicates"),children:Array.from({length:Math.max(0,o-1)},(x,E)=>E+2).map(x=>s.jsxs("option",{value:`best:${x}`,children:[x," ",t("qpcr.replicatesUnit")]},`best:${x}`))}),s.jsxs("optgroup",{label:t("qpcr.outlierRemoval"),children:[s.jsx("option",{value:"outlier:1.5",children:"±1.5 SD"}),s.jsx("option",{value:"outlier:2",children:"±2 SD"}),s.jsx("option",{value:"outlier:3",children:"±3 SD"})]})]})]})}),s.jsx("button",{className:"btn btn-primary btn-full",onClick:O,disabled:!P,children:t(h==="processing"?"qpcr.calculating":"qpcr.calculateAction")}),h==="success"&&F&&s.jsxs("div",{className:"result-success",children:[s.jsx(he,{size:14,stroke:1.75}),s.jsx("div",{children:F})]}),h==="error"&&s.jsxs("div",{className:"result-success",style:{color:"#ff453a",background:"rgba(255,69,58,0.08)"},children:[s.jsx(Se,{size:14,stroke:1.75}),s.jsx("div",{children:_})]})]})}function Ot(){const{t:e,language:r}=oe(),[n,l]=A.useState(null),[a,t]=A.useState(""),[m,o]=A.useState([]),[u,g]=A.useState(!1),[c,i]=A.useState(""),[v,f]=A.useState(null),S=A.useCallback((p,_="indeterminate")=>{i(p),f(_==="indeterminate"?null:0),g(!0)},[]),w=A.useCallback(()=>{g(!1),f(null)},[]),C=A.useCallback((p,_,d)=>{const F=_>0?Math.round(p/_*100):0;f(F),d&&i(d),g(!0)},[]),R=A.useCallback(async()=>{if(!n)return!1;try{return await Ae(n.workbook,n.path),!0}catch(p){return U(e("qpcr.saveFailed",{detail:p instanceof Error?p.message:String(p)}),"error"),!1}},[n]),$=A.useCallback(async p=>{o(p),S(e("qpcr.save"),"indeterminate");try{await R()}finally{w()}},[R,S,w]),h=A.useCallback(async(p,_,d)=>{if(n)try{S(e("qpcr.save"),"indeterminate"),await R(),S(e("qpcr.generating"),"determinate");const F=await $t(n.path,p,_,(y,N)=>{C(y,N,`${e("qpcr.generating")} (${y}/${N})...`)},d);if(F.success){const y=F.chartsCreated??0,N=F.reason?`，${F.reason}`:"";U(e("qpcr.chartComplete",{count:y,detail:N}),"success")}else U(e("qpcr.chartFailed",{detail:F.reason??(r==="en"?"Unknown error":"未知错误")}),"error")}catch(F){U(e("qpcr.chartError",{detail:String(F)}),"error")}finally{w()}},[n,R,S,w,C]);return s.jsxs("div",{className:"page-shell page-shell--wide",children:[s.jsx(Be,{visible:u,text:c,progress:v}),s.jsxs("div",{className:"panel-header",children:[s.jsx("div",{className:"panel-icon",style:{background:"#0a84ff"},children:s.jsx(Oe,{size:18,color:"white",stroke:1.75})}),s.jsxs("div",{className:"panel-title",children:[s.jsx("h2",{children:e("qpcr.title")}),s.jsx("p",{children:e("qpcr.subtitle")})]}),s.jsx("div",{className:"panel-actions",children:s.jsx(Pe,{children:p=>s.jsx(We,{onClose:p})})})]}),s.jsxs("div",{className:"card",children:[s.jsxs("div",{className:"card-title",children:[s.jsx(_e,{size:14,stroke:1.75}),s.jsx("span",{children:e("qpcr.dataFile")})]}),s.jsx("div",{className:"card-body",children:s.jsx(ze,{file:n,sheetName:a,onFileChange:p=>{if(l(p),p){const _=pe(p.workbook);o(_)}else t(""),o([]),w()},onSheetChange:t})})]}),s.jsxs("div",{className:"card-grid card-grid--2",children:[s.jsxs("div",{className:"card",children:[s.jsxs("div",{className:"card-title",children:[s.jsx("span",{className:"step-num",children:"1"}),s.jsx("span",{children:e("qpcr.transform")})]}),s.jsx("div",{className:"card-body",children:s.jsx(et,{workbook:(n==null?void 0:n.workbook)??null,sheetName:a,onComplete:$,onProgress:C,onError:w})})]}),s.jsxs("div",{className:"card",children:[s.jsxs("div",{className:"card-title",children:[s.jsx("span",{className:"step-num",children:"2"}),s.jsx("span",{children:e("qpcr.calculate")})]}),s.jsx("div",{className:"card-body",children:s.jsx(Et,{workbook:(n==null?void 0:n.workbook)??null,geneNames:m,onComplete:h,onProgress:C,onError:w})})]})]})]})}export{Ot as default};
