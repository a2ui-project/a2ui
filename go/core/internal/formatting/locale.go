// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Package formatting implements locale-aware number, currency, TR35 date, and CLDR plural formatting
// for the A2UI Basic Catalog.
package formatting

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

type localeSpec struct {
	groupSep        string
	decimalSep      string
	currencyPattern string // CLDR standard currency pattern using '¤'
	wideMonths      [12]string
	shortMonths     [12]string
	wideWeekdays    [7]string // Sunday=0 .. Saturday=6
	shortWeekdays   [7]string
	pluralRule      func(n float64) string
}

var (
	enWideMonths    = [12]string{"January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"}
	enShortMonths   = [12]string{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}
	enWideWeekdays  = [7]string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}
	enShortWeekdays = [7]string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}

	defaultLocale = localeSpec{
		groupSep:        ",",
		decimalSep:      ".",
		currencyPattern: "¤#,##0.00",
		wideMonths:      enWideMonths,
		shortMonths:     enShortMonths,
		wideWeekdays:    enWideWeekdays,
		shortWeekdays:   enShortWeekdays,
		pluralRule:      pluralOneOther,
	}

	locales = map[string]localeSpec{
		"en": defaultLocale,
		"de": {
			groupSep:        ".",
			decimalSep:      ",",
			currencyPattern: "#,##0.00\u00a0¤",
			wideMonths:      [12]string{"Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"},
			shortMonths:     [12]string{"Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez."},
			wideWeekdays:    [7]string{"Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"},
			shortWeekdays:   [7]string{"So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."},
			pluralRule:      pluralOneOther,
		},
		"fr": {
			groupSep:        "\u202f",
			decimalSep:      ",",
			currencyPattern: "#,##0.00\u00a0¤",
			wideMonths:      [12]string{"janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"},
			shortMonths:     [12]string{"janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."},
			wideWeekdays:    [7]string{"dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"},
			shortWeekdays:   [7]string{"dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."},
			pluralRule: func(n float64) string {
				if n >= 0 && n < 2 {
					return "one"
				}
				return "other"
			},
		},
		"es": {
			groupSep:        ".",
			decimalSep:      ",",
			currencyPattern: "#,##0.00\u00a0¤",
			wideMonths:      enWideMonths,
			shortMonths:     enShortMonths,
			wideWeekdays:    enWideWeekdays,
			shortWeekdays:   enShortWeekdays,
			pluralRule:      pluralOneOther,
		},
		"ja": {
			groupSep:        ",",
			decimalSep:      ".",
			currencyPattern: "¤#,##0.00",
			wideMonths:      enWideMonths,
			shortMonths:     enShortMonths,
			wideWeekdays:    enWideWeekdays,
			shortWeekdays:   enShortWeekdays,
			pluralRule:      func(float64) string { return "other" },
		},
		"zh": {
			groupSep:        ",",
			decimalSep:      ".",
			currencyPattern: "¤#,##0.00",
			wideMonths:      enWideMonths,
			shortMonths:     enShortMonths,
			wideWeekdays:    enWideWeekdays,
			shortWeekdays:   enShortWeekdays,
			pluralRule:      func(float64) string { return "other" },
		},
		"ru": {
			groupSep:        "\u00a0",
			decimalSep:      ",",
			currencyPattern: "#,##0.00\u00a0¤",
			wideMonths:      enWideMonths,
			shortMonths:     enShortMonths,
			wideWeekdays:    enWideWeekdays,
			shortWeekdays:   enShortWeekdays,
			pluralRule:      pluralSlavic,
		},
		"pl": {
			groupSep:        "\u00a0",
			decimalSep:      ",",
			currencyPattern: "#,##0.00\u00a0¤",
			wideMonths:      enWideMonths,
			shortMonths:     enShortMonths,
			wideWeekdays:    enWideWeekdays,
			shortWeekdays:   enShortWeekdays,
			pluralRule:      pluralPolish,
		},
		"ar": {
			groupSep:        ",",
			decimalSep:      ".",
			currencyPattern: "¤\u00a0#,##0.00",
			wideMonths:      enWideMonths,
			shortMonths:     enShortMonths,
			wideWeekdays:    enWideWeekdays,
			shortWeekdays:   enShortWeekdays,
			pluralRule:      pluralArabic,
		},
	}

	currencySymbols = map[string]string{
		"USD": "$",
		"EUR": "€",
		"GBP": "£",
		"JPY": "¥",
		"CNY": "CN¥",
		"INR": "₹",
		"KRW": "₩",
		"BRL": "R$",
		"CAD": "CA$",
		"AUD": "A$",
		"MXN": "MX$",
		"TWD": "NT$",
		"HKD": "HK$",
		"NZD": "NZ$",
		"ILS": "₪",
		"VND": "₫",
		"THB": "฿",
		"PHP": "₱",
		"NGN": "₦",
		"UAH": "₴",
	}

	dateTokenRe = regexp.MustCompile(`yyyy|yy|MMMM|MMM|MM|M|EEEE|E|dd|d|HH|H|hh|h|mm|ss|a`)
	isoDateRe   = regexp.MustCompile(`^([+-]?\d{4,6})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:([zZ])|([+-])(\d{2})(?::?(\d{2}))?)?)?$`)
)

func pluralOneOther(n float64) string {
	if n == 1 {
		return "one"
	}
	return "other"
}

func pluralSlavic(n float64) string {
	if n != math.Trunc(n) {
		return "other"
	}
	i := int64(math.Abs(n))
	mod10 := i % 10
	mod100 := i % 100
	if mod10 == 1 && mod100 != 11 {
		return "one"
	}
	if mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) {
		return "few"
	}
	if mod10 == 0 || (mod10 >= 5 && mod10 <= 9) || (mod100 >= 11 && mod100 <= 14) {
		return "many"
	}
	return "other"
}

func pluralPolish(n float64) string {
	if n != math.Trunc(n) {
		return "other"
	}
	i := int64(math.Abs(n))
	if i == 1 {
		return "one"
	}
	mod10 := i % 10
	mod100 := i % 100
	if mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) {
		return "few"
	}
	return "many"
}

func pluralArabic(n float64) string {
	if n == 0 {
		return "zero"
	}
	if n == 1 {
		return "one"
	}
	if n == 2 {
		return "two"
	}
	if n == math.Trunc(n) {
		mod100 := int64(math.Abs(n)) % 100
		if mod100 >= 3 && mod100 <= 10 {
			return "few"
		}
		if mod100 >= 11 && mod100 <= 99 {
			return "many"
		}
	}
	return "other"
}

func resolveLocale(tag string) localeSpec {
	if tag == "" {
		return defaultLocale
	}
	norm := strings.ReplaceAll(strings.TrimSpace(tag), "_", "-")
	lower := strings.ToLower(norm)
	if spec, ok := locales[lower]; ok {
		return spec
	}
	lang := lower
	if idx := strings.IndexByte(lower, '-'); idx > 0 {
		lang = lower[:idx]
	}
	if spec, ok := locales[lang]; ok {
		return spec
	}
	return defaultLocale
}

// FormatNumber formats val with optional fixed decimals and grouping separators.
func FormatNumber(val float64, decimals *int, grouping bool, locale string) string {
	if math.IsNaN(val) {
		return ""
	}
	if math.IsInf(val, 1) {
		return "∞"
	}
	if math.IsInf(val, -1) {
		return "-∞"
	}
	loc := resolveLocale(locale)
	neg := val < 0
	absVal := math.Abs(val)

	var formatted string
	if decimals != nil {
		d := *decimals
		if d < 0 {
			d = 0
		} else if d > 20 {
			d = 20
		}
		formatted = roundFixed(absVal, d)
	} else {
		formatted = roundFixed(absVal, 3)
		if strings.IndexByte(formatted, '.') >= 0 {
			formatted = strings.TrimRight(formatted, "0")
			formatted = strings.TrimRight(formatted, ".")
		}
	}

	intPart := formatted
	fracPart := ""
	if dot := strings.IndexByte(formatted, '.'); dot >= 0 {
		intPart = formatted[:dot]
		fracPart = formatted[dot+1:]
	}
	if grouping {
		intPart = groupDigits(intPart, loc.groupSep)
	}

	var b strings.Builder
	// Avoid "-0" when rounded magnitude is zero.
	isZero := isAllZeros(intPart) && isAllZeros(fracPart)
	if neg && !isZero {
		b.WriteByte('-')
	}
	b.WriteString(intPart)
	if fracPart != "" {
		b.WriteString(loc.decimalSep)
		b.WriteString(fracPart)
	}
	return b.String()
}

func isAllZeros(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= '1' && s[i] <= '9' {
			return false
		}
	}
	return true
}

func roundFixed(absVal float64, decimals int) string {
	if decimals == 0 {
		return strconv.FormatFloat(math.Round(absVal), 'f', 0, 64)
	}
	scale := math.Pow10(decimals)
	if scaled := absVal * scale; !math.IsInf(scaled, 0) && scaled < 1e15 {
		rounded := math.Round(scaled) / scale
		return strconv.FormatFloat(rounded, 'f', decimals, 64)
	}
	return strconv.FormatFloat(absVal, 'f', decimals, 64)
}

func groupDigits(intPart string, sep string) string {
	if len(intPart) <= 3 || sep == "" {
		return intPart
	}
	rem := len(intPart) % 3
	var b strings.Builder
	if rem > 0 {
		b.WriteString(intPart[:rem])
	}
	for i := rem; i < len(intPart); i += 3 {
		if b.Len() > 0 {
			b.WriteString(sep)
		}
		b.WriteString(intPart[i : i+3])
	}
	return b.String()
}

// FormatCurrency formats val as an ISO 4217 currency amount with CLDR currencySpacing.
func FormatCurrency(val float64, currency string, decimals int, grouping bool, locale string) string {
	if math.IsNaN(val) {
		return ""
	}
	code := strings.ToUpper(strings.TrimSpace(currency))
	if code == "" {
		code = "USD"
	}
	loc := resolveLocale(locale)
	sym, ok := currencySymbols[code]
	if !ok {
		sym = code
	}

	neg := val < 0
	absStr := FormatNumber(math.Abs(val), &decimals, grouping, locale)
	isZero := isAllZeros(absStr)

	pattern := applyCurrencySpacing(loc.currencyPattern, sym)
	rendered := strings.ReplaceAll(pattern, "#,##0.00", absStr)
	rendered = strings.ReplaceAll(rendered, "¤", sym)
	if neg && !isZero {
		return "-" + rendered
	}
	return rendered
}

func applyCurrencySpacing(pattern string, symbol string) string {
	if symbol == "" || !strings.ContainsRune(pattern, '¤') {
		return pattern
	}
	firstRune, _ := utf8.DecodeRuneInString(symbol)
	lastRune, _ := utf8.DecodeLastRuneInString(symbol)
	runes := []rune(pattern)
	var out []rune
	for i, r := range runes {
		if r != '¤' {
			out = append(out, r)
			continue
		}
		var prev rune
		if i > 0 {
			prev = runes[i-1]
		}
		if (prev == '#' || prev == '0') && !unicode.IsSymbol(firstRune) && len(out) > 0 && out[len(out)-1] != '\u00a0' {
			out = append(out, '\u00a0')
		}
		out = append(out, r)
		var next rune
		if i+1 < len(runes) {
			next = runes[i+1]
		}
		if (next == '#' || next == '0') && !unicode.IsSymbol(lastRune) {
			out = append(out, '\u00a0')
		}
	}
	return string(out)
}

type parsedTimestamp struct {
	instant time.Time
	written time.Time
}

func parseISOTimestamp(raw string) (parsedTimestamp, bool) {
	m := isoDateRe.FindStringSubmatch(strings.TrimSpace(raw))
	if m == nil {
		return parsedTimestamp{}, false
	}
	year, err1 := strconv.Atoi(m[1])
	month, err2 := strconv.Atoi(m[2])
	day, err3 := strconv.Atoi(m[3])
	if err1 != nil || err2 != nil || err3 != nil {
		return parsedTimestamp{}, false
	}
	hour, minVal, sec, nsec := 0, 0, 0, 0
	if m[4] != "" {
		var errH, errM error
		hour, errH = strconv.Atoi(m[4])
		minVal, errM = strconv.Atoi(m[5])
		if errH != nil || errM != nil {
			return parsedTimestamp{}, false
		}
		if m[6] != "" {
			var errS error
			sec, errS = strconv.Atoi(m[6])
			if errS != nil {
				return parsedTimestamp{}, false
			}
		}
		if m[7] != "" {
			frac := m[7]
			if len(frac) > 9 {
				frac = frac[:9]
			} else {
				frac += strings.Repeat("0", 9-len(frac))
			}
			nsec, _ = strconv.Atoi(frac)
		}
	}

	loc := time.UTC
	if m[9] != "" {
		offH, _ := strconv.Atoi(m[10])
		offM := 0
		if m[11] != "" {
			offM, _ = strconv.Atoi(m[11])
		}
		offsetSec := (offH*60 + offM) * 60
		if m[9] == "-" {
			offsetSec = -offsetSec
		}
		loc = time.FixedZone("", offsetSec)
	}

	written := time.Date(year, time.Month(month), day, hour, minVal, sec, nsec, loc)
	// Reject non-existent calendar dates/times (such as 2026-02-30 or 2026-13-01) that roll over.
	if written.Year() != year || int(written.Month()) != month || written.Day() != day ||
		written.Hour() != hour || written.Minute() != minVal || written.Second() != sec {
		return parsedTimestamp{}, false
	}
	return parsedTimestamp{
		instant: written.UTC(),
		written: written,
	}, true
}

// FormatDate formats raw ISO-8601 timestamp using TR35 tokens or "ISO".
func FormatDate(raw string, format string, locale string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	ts, ok := parseISOTimestamp(raw)
	if !ok {
		return ""
	}
	if format == "" {
		format = "yyyy-MM-dd"
	}
	if format == "ISO" {
		u := ts.instant
		millis := u.Nanosecond() / 1_000_000
		return fmt.Sprintf(
			"%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
			u.Year(), int(u.Month()), u.Day(),
			u.Hour(), u.Minute(), u.Second(), millis,
		)
	}

	loc := resolveLocale(locale)
	w := ts.written
	hr12 := w.Hour() % 12
	if hr12 == 0 {
		hr12 = 12
	}
	yrStr := strconv.Itoa(w.Year())
	yyStr := fmt.Sprintf("%02d", ((w.Year()%100)+100)%100)

	return dateTokenRe.ReplaceAllStringFunc(format, func(tok string) string {
		switch tok {
		case "yyyy":
			return yrStr
		case "yy":
			return yyStr
		case "MMMM":
			return loc.wideMonths[int(w.Month())-1]
		case "MMM":
			return loc.shortMonths[int(w.Month())-1]
		case "MM":
			return fmt.Sprintf("%02d", int(w.Month()))
		case "M":
			return strconv.Itoa(int(w.Month()))
		case "EEEE":
			return loc.wideWeekdays[int(w.Weekday())]
		case "E":
			return loc.shortWeekdays[int(w.Weekday())]
		case "dd":
			return fmt.Sprintf("%02d", w.Day())
		case "d":
			return strconv.Itoa(w.Day())
		case "HH":
			return fmt.Sprintf("%02d", w.Hour())
		case "H":
			return strconv.Itoa(w.Hour())
		case "hh":
			return fmt.Sprintf("%02d", hr12)
		case "h":
			return strconv.Itoa(hr12)
		case "mm":
			return fmt.Sprintf("%02d", w.Minute())
		case "ss":
			return fmt.Sprintf("%02d", w.Second())
		case "a":
			if w.Hour() < 12 {
				return "AM"
			}
			return "PM"
		default:
			return tok
		}
	})
}

// Pluralize selects the CLDR plural category for val, honoring explicit 0/1/2 overrides and empty strings.
func Pluralize(val float64, forms map[string]string, present map[string]bool, locale string) string {
	loc := resolveLocale(locale)
	category := "other"
	if val == 0 && present["zero"] {
		category = "zero"
	} else if val == 1 && present["one"] {
		category = "one"
	} else if val == 2 && present["two"] {
		category = "two"
	} else if !math.IsNaN(val) && !math.IsInf(val, 0) && loc.pluralRule != nil {
		category = loc.pluralRule(val)
	}
	if present[category] {
		return forms[category]
	}
	if present["other"] {
		return forms["other"]
	}
	return ""
}
