//! JavaScript value semantics needed for byte-exact parity with the legacy
//! TypeScript pipeline (V8 / ECMAScript behavior on `f64` and strings).
//!
//! The legacy code interpolates numbers into strings, `String()`-coerces
//! cell values, uses `parseFloat` and computes column widths from the
//! *rendered* length of a value. Each of these has ECMAScript-specific
//! behavior (shortest round-trip formatting, exponent notation for very
//! small/large magnitudes, CJK display width) that Rust's default formatting
//! does not reproduce, so it is implemented here once and used everywhere.

use mynx_contracts::qpcr::CellValue;

/// ECMAScript `String(number)` — the shortest decimal representation that
/// round-trips, with fixed notation for 1e-6 ≤ |x| < 1e21 and exponential
/// notation otherwise (`1e-7`, `1e+21`). NaN → `"NaN"`, ±∞ → `±"Infinity"`,
/// −0 → `"0"`.
pub fn js_number_to_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".to_string();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    if x == 0.0 {
        // Covers both +0 and -0 (JS String(-0) === "0").
        return "0".to_string();
    }

    // Rust's LowerExp produces the shortest round-trip digits, same digit
    // sequence the ECMAScript ToString algorithm selects. Re-format it into
    // JS notation: mantissa "d.ddd" with exponent `exp` means k significant
    // digits and decimal point after position n = exp + 1.
    let formatted = format!("{:e}", x);
    let (mantissa, exponent) = formatted.split_once('e').expect("LowerExp output");
    let exponent: i32 = exponent.parse().expect("LowerExp exponent");
    let negative = mantissa.starts_with('-');
    let digits: String = mantissa.chars().filter(|c| c.is_ascii_digit()).collect();
    let k = digits.len() as i32;
    let n = exponent + 1;

    let mut out = String::new();
    if negative {
        out.push('-');
    }
    if k <= n && n <= 21 {
        // Integer: digits followed by n-k zeros.
        out.push_str(&digits);
        for _ in 0..(n - k) {
            out.push('0');
        }
    } else if n > 0 && n <= 21 {
        // Fixed with a decimal point inside the digits.
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if n > -6 && n <= 0 {
        // Fixed with leading "0.000…".
        out.push_str("0.");
        for _ in 0..-n {
            out.push('0');
        }
        out.push_str(&digits);
    } else {
        // Exponential: "d.ddd e±ee" (exponent carries no zero padding).
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        let e = n - 1;
        out.push(if e < 0 { '-' } else { '+' });
        out.push_str(&e.abs().to_string());
    }
    out
}

/// ECMAScript `parseFloat`: longest prefix matching
/// `Whitespace* [+-] (Infinity | Digits[.Digits][e[+-]Digits])`, else NaN.
pub fn js_parse_float(raw: &str) -> f64 {
    let s = raw.trim_start_matches(is_js_whitespace);
    let bytes = s.as_bytes();
    let mut i = 0;
    let mut sign = 1.0f64;
    if i < bytes.len() && (bytes[i] == b'+' || bytes[i] == b'-') {
        if bytes[i] == b'-' {
            sign = -1.0;
        }
        i += 1;
    }
    if s[i..].starts_with("Infinity") {
        return sign * f64::INFINITY;
    }

    let int_start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    let mut has_number = i > int_start;
    if i < bytes.len() && bytes[i] == b'.' {
        let frac_start = i + 1;
        let mut j = frac_start;
        while j < bytes.len() && bytes[j].is_ascii_digit() {
            j += 1;
        }
        if j > frac_start {
            has_number = true;
            i = j;
        }
    }
    if !has_number {
        return f64::NAN;
    }
    // Optional exponent, only valid right after the mantissa.
    if i < bytes.len() && (bytes[i] == b'e' || bytes[i] == b'E') {
        let mut j = i + 1;
        if j < bytes.len() && (bytes[j] == b'+' || bytes[j] == b'-') {
            j += 1;
        }
        let exp_start = j;
        while j < bytes.len() && bytes[j].is_ascii_digit() {
            j += 1;
        }
        if j > exp_start {
            i = j;
        }
    }
    s[..i].parse::<f64>().unwrap_or(f64::NAN)
}

fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// JavaScript `String(value)` for a cell value: `null`/empty → `""`,
/// numbers via [`js_number_to_string`], text verbatim.
pub fn js_string_of_value(value: &CellValue) -> String {
    match value {
        CellValue::Empty => String::new(),
        CellValue::Num(n) => js_number_to_string(*n),
        CellValue::Text(s) => s.clone(),
    }
}

/// Display length in Excel column-width units: CJK/full-width characters
/// count as 2, everything else as 1. Mirrors the legacy regex, which runs
/// on UTF-16 code units — astral (non-BMP) characters are two units and
/// neither unit matches the CJK ranges, so they also total 2.
pub fn display_length(text: &str) -> usize {
    text.chars()
        .map(|ch| {
            let u = ch as u32;
            if u > 0xFFFF {
                2
            } else {
                match u {
                    // 0x3000..=0x303F (CJK punctuation) is already covered by
                    // 0x2E80..=0xA4CF, matching the legacy regex's intent.
                    0x1100..=0x115F
                    | 0x2E80..=0xA4CF
                    | 0xA960..=0xA97F
                    | 0xAC00..=0xD7A3
                    | 0xF900..=0xFAFF
                    | 0xFE10..=0xFE19
                    | 0xFE30..=0xFE6F
                    | 0xFF00..=0xFF60
                    | 0xFFE0..=0xFFE6 => 2,
                    _ => 1,
                }
            }
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn number_to_string_matches_js() {
        assert_eq!(js_number_to_string(0.0), "0");
        assert_eq!(js_number_to_string(-0.0), "0");
        assert_eq!(js_number_to_string(2.0), "2");
        assert_eq!(js_number_to_string(50.0), "50");
        assert_eq!(js_number_to_string(1234.5), "1234.5");
        assert_eq!(js_number_to_string(-12.25), "-12.25");
        assert_eq!(
            js_number_to_string(0.08838834764831845),
            "0.08838834764831845"
        );
        assert_eq!(js_number_to_string(1e-6), "0.000001");
        assert_eq!(js_number_to_string(1e-7), "1e-7");
        assert_eq!(js_number_to_string(2f64.powi(-20)), "9.5367431640625e-7");
        assert_eq!(js_number_to_string(1e21), "1e+21");
        assert_eq!(js_number_to_string(1e-21), "1e-21");
        assert_eq!(js_number_to_string(f64::NAN), "NaN");
        assert_eq!(js_number_to_string(f64::INFINITY), "Infinity");
        assert_eq!(js_number_to_string(f64::NEG_INFINITY), "-Infinity");
    }

    #[test]
    fn parse_float_matches_js() {
        assert_eq!(js_parse_float("12.5"), 12.5);
        assert_eq!(js_parse_float("  12.5abc"), 12.5);
        assert!(js_parse_float("").is_nan());
        assert!(js_parse_float("abc").is_nan());
        assert!(js_parse_float("null").is_nan());
        assert_eq!(js_parse_float("0x10"), 0.0); // parseFloat does not parse hex
        assert_eq!(js_parse_float("-3.5"), -3.5);
        assert_eq!(js_parse_float("+2e2"), 200.0);
        assert_eq!(js_parse_float("1e"), 1.0); // dangling exponent ignored
        assert_eq!(js_parse_float(".5"), 0.5);
        assert_eq!(js_parse_float("1 2"), 1.0);
        assert_eq!(js_parse_float("\u{00A0}7"), 7.0);
    }

    #[test]
    fn display_length_counts_cjk_as_two() {
        assert_eq!(display_length("Num"), 3);
        assert_eq!(display_length("对照组"), 6);
        assert_eq!(display_length("干扰素γ"), 7); // γ is not CJK-wide
        assert_eq!(display_length(""), 0);
        assert_eq!(display_length("ＡＢ"), 4); // fullwidth forms FF00-FF60
        assert_eq!(display_length("\u{1F3B0}"), 2); // astral char = 2 UTF-16 units
    }
}
