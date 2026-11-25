from pathlib import Path
from PIL import Image
import numpy as np
import json, hashlib
ROOT = Path(__file__).resolve().parent
p = ROOT / "rocks_generation.json"
doc = json.loads(p.read_text())
def rounded(v):
    if isinstance(v, np.generic): v=v.item()
    return round(float(v), 4)
def pair_diff(a,b):
    return abs(a-b)/((a+b)/2)*100 if a+b else 0
for r in doc["records"]:
    fp = ROOT/r["filename"]
    im = Image.open(fp)
    source_mode = im.mode
    ar = np.asarray(im.convert("RGBA"))
    h,w = ar.shape[:2]
    cell = w/3
    if w%3: raise ValueError("Canvas not divisible by 3: "+r["filename"])
    cell=int(cell)
    sx=cell/512
    sy=h/512
    span={"S":2,"M":4,"L":8}[r["size"]]
    ppm=cell/span
    alpha=ar[:,:,3]
    base_mask=alpha>=128
    luminance = ar[:,:,:3].astype(float) @ np.array([0.2126,0.7152,0.0722])
    m={
      "image_px":[w,h], "png_mode":source_mode, "sha256":hashlib.sha256(fp.read_bytes()).hexdigest(),
      "actual_cell_width_px":cell, "actual_cell_height_px":h, "cell_span_m":span,
      "pixels_per_meter":ppm, "normalization_scale_xy":[sx,sy],
      "alpha":{"minimum":int(alpha.min()),"maximum":int(alpha.max()),"zero_pixels":int((alpha==0).sum()),"zero_fraction":rounded((alpha==0).mean()),"nonzero_pixels":int((alpha>0).sum()),"at_least_128_pixels":int(base_mask.sum()),"edge_maximum":int(max(alpha[0,:].max(),alpha[-1,:].max(),alpha[:,0].max(),alpha[:,-1].max()))},
      "brightness_std_all_subject":rounded(luminance[base_mask].std()),
    }
    target=r["spec_target"]["size_m"]
    all_target=True
    ground_ok=True
    centers_ok=True
    for i,view in enumerate(["front","side","top"]):
        a=alpha[:,i*cell:(i+1)*cell]
        mask=a>=128
        ys,xs=np.nonzero(mask)
        if not len(xs): raise ValueError("No opaque subject: "+r["filename"]+" "+view)
        bb=[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)]
        bw,bh=bb[2]-bb[0],bb[3]-bb[1]
        norm=[bb[0]/sx,bb[1]/sy,bb[2]/sx,bb[3]/sy]
        centers=[(bb[0]+bb[2])/2/cell,(bb[1]+bb[3])/2/h]
        d={"width":rounded(bw/ppm),"height":rounded(bh/ppm)}
        keyx,keyy = ("width","height") if view=="front" else (("depth","height") if view=="side" else ("width","depth"))
        dims={keyx:rounded(bw/ppm),keyy:rounded(bh/ppm)}
        errs={k:rounded((dims[k]-target[k])/target[k]*100) for k in dims}
        target_pass=all(abs(v)<=8 for v in errs.values())
        center_pass=abs(centers[0]-.5)<=.06
        if view=="top": center_pass=center_pass and abs(centers[1]-.5)<=.06
        centers_ok &= center_pass
        all_target &= target_pass
        sublum=luminance[:,i*cell:(i+1)*cell][mask]
        v={"bbox_px_local_exclusive":bb,"bbox_px_global_exclusive":[bb[0]+i*cell,bb[1],bb[2]+i*cell,bb[3]],
           "bbox_normalized_to_512_cell":list(map(rounded,norm)),
           "width_px":bw,"height_px":bh,"center_fraction":list(map(rounded,centers)),
           "dimensions_m":dims,"target_error_percent":errs,"target_within_8_percent":target_pass,
           "center_within_6_percent":bool(center_pass),"brightness_std":rounded(sublum.std())}
        if view!="top":
            last=bb[3]-1
            after=int(np.floor(392*sy))+1
            pixels_below=int((a[after:,:]>=128).sum())
            v["last_subject_row_normalized"]=rounded(last/sy)
            v["ground_line_deviation_normalized_px"]=rounded(last/sy-384)
            v["opaque_pixels_below_ground_plus_8px"]=pixels_below
            v["nonzero_alpha_pixels_below_ground_plus_8px"]=int((a[after:,:]>0).sum())
            v["ground_allowance_pass"]=pixels_below==0
            ground_ok &= pixels_below==0
        m[view]=v
    f,s,t=m["front"],m["side"],m["top"]
    diffs={
      "front_width_vs_top_width":pair_diff(f["width_px"],t["width_px"]),
      "side_width_vs_top_depth":pair_diff(s["width_px"],t["height_px"]),
      "front_height_vs_side_height":pair_diff(f["height_px"],s["height_px"])
    }
    m["view_dimension_differences_percent"]={k:rounded(v) for k,v in diffs.items()}
    m["dimension_consistency_pass"]=all(v<=8 for v in diffs.values())
    m["dimension_target_pass"]=bool(all_target)
    m["centering_pass"]=bool(centers_ok)
    m["ground_allowance_pass"]=bool(ground_ok)
    m["canvas_spec_pass"]=[w,h]==[1536,512]
    m["brightness_minimum_pass"]=all(m[v]["brightness_std"]>=18 for v in ["front","side","top"])
    m["brightness_goal_pass"]=all(20<=m[v]["brightness_std"]<=35 for v in ["front","side","top"])
    m["measured_dimensions_m_for_patterns"]={"width":f["dimensions_m"]["width"],"depth":t["dimensions_m"]["depth"],"height":f["dimensions_m"]["height"]}
    m["patterns_measurement_method"]="alpha >= 128 exclusive bbox; width=front width, depth=top height, height=front height, each divided by actual cell width/(S:2m,M:4m,L:8m)."
    notes=[]
    if not m["canvas_spec_pass"]: notes.append(f"Canvas {w}x{h}, requested 1536x512; raw PNG retained without resampling.")
    for v in ["front","side"]:
        row=m[v]["last_subject_row_normalized"]
        delta=m[v]["ground_line_deviation_normalized_px"]
        notes.append(f"{v} last alpha>=128 row at normalized y={row}, ground y384 deviation={delta:+.4f}px; ground allowance pass={m[v]['ground_allowance_pass']}.")
    for k,v in m["view_dimension_differences_percent"].items():
        if v>8: notes.append(f"Three-view mismatch {k}: {v}% (limit 8%).")
    if not m["dimension_target_pass"]: notes.append("One or more measured dimensions differ from listed design targets by over 8%; see per-view target_error_percent. Target dimensions are preserved separately.")
    if not m["centering_pass"]: notes.append("One or more bbox centers exceed 6% cell offset; see center_fraction.")
    if not m["brightness_minimum_pass"]: notes.append("One or more view brightness standard deviations fall below acceptance minimum 18.")
    if not m["brightness_goal_pass"]: notes.append("One or more view brightness standard deviations are outside goal 20–35; includes moss, veins and soil, not a semantic rock-only segmentation.")
    notes.append("Alpha transparency exists; faint partially transparent edge pixels remain. Ground check uses alpha>=128 and additionally reports all alpha>0 pixels.")
    notes.append("Texture detail and pose correspondence judged visually; orthographic ray geometry and exact feature correspondence are not established by bbox tests.")
    r["measurement"]=m
    m["source_png_byte_identical"] = fp.read_bytes() == Path(r["source_path"]).read_bytes()
    m["overall_technical_acceptance"] = bool(m["canvas_spec_pass"] and m["dimension_consistency_pass"] and m["ground_allowance_pass"] and m["centering_pass"] and m["brightness_minimum_pass"])
    if r["id"] == "R-10": notes.append("Visual deviation: root-like fibrous shapes appeared at the foot of the leaning slab, although only rock was requested.")
    r["validation_notes"]=notes
    r["spec_notes"]="Original generated PNG, no resize/crop/retouch; technical deviations recorded in measurement and validation_notes."
doc["measurement_method"]={"bbox":"Per actual equal-width cell, alpha>=128; upper-right coordinates exclusive.", "meter_scale":"Actual cell width divided by 2m (S), 4m (M), or 8m (L); same pixels-per-meter for horizontal and vertical dimensions.","view_difference_percent":"100*abs(a-b)/((a+b)/2); maximum 8%.","ground":"Last alpha>=128 row normalized to 512-high cell, compared with y384. Pixels strictly below normalized y392 reported; below-ground allowance not treated as proof of correct ground anchoring.","centering":"BBox center within 6% of cell midpoint, top also vertical; not a semantic center-of-mass test.","brightness":"Rec.709 code-value luminance standard deviation on alpha>=128; includes non-rock moss/crystal pixels."}
doc["status"]="complete_with_nonconformities" if len(doc["records"])==20 else "in_progress_with_nonconformities"
doc["summary"]={"generated":len(doc["records"]),"visually_reviewed":sum(r.get("visual_review",{}).get("reviewed",False) for r in doc["records"]),"unique_png_sha256":len({r["measurement"]["sha256"] for r in doc["records"]}),"all_source_pngs_byte_identical":all(r["measurement"]["source_png_byte_identical"] for r in doc["records"]),"canvas_exact_pass":sum(r["measurement"]["canvas_spec_pass"] for r in doc["records"]),"view_dimensions_within_8_percent_pass_ids":[r["id"] for r in doc["records"] if r["measurement"]["dimension_consistency_pass"]],"ground_allowance_pass_ids":[r["id"] for r in doc["records"] if r["measurement"]["ground_allowance_pass"]],"centering_pass_count":sum(r["measurement"]["centering_pass"] for r in doc["records"]),"brightness_minimum_pass_count":sum(r["measurement"]["brightness_minimum_pass"] for r in doc["records"]),"brightness_goal_pass_count":sum(r["measurement"]["brightness_goal_pass"] for r in doc["records"]),"overall_technical_acceptance_count":sum(r["measurement"]["overall_technical_acceptance"] for r in doc["records"])}
p.write_text(json.dumps(doc,ensure_ascii=False,indent=2)+"\n")
print(json.dumps({"records":len(doc["records"]),"canvas_pass":sum(r["measurement"]["canvas_spec_pass"] for r in doc["records"]),"dimension_consistency_pass":sum(r["measurement"]["dimension_consistency_pass"] for r in doc["records"]),"ground_allowance_pass":sum(r["measurement"]["ground_allowance_pass"] for r in doc["records"]),"brightness_minimum_pass":sum(r["measurement"]["brightness_minimum_pass"] for r in doc["records"])},ensure_ascii=False))
