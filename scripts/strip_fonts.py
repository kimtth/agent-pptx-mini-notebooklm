"""One-time script to strip ### Fonts sections from styles.md."""
import re, pathlib

p = pathlib.Path(__file__).resolve().parent.parent / "skills" / "pptx-design-styles" / "references" / "styles.md"
content = p.read_text(encoding="utf-8")

# Remove ### Fonts + all following lines until next ### or ---
pattern = r"### Fonts\n(?:(?!###|---).*\n)*\n?"
result = re.sub(pattern, "", content)
result = re.sub(r"\n{3,}", "\n\n", result)

p.write_text(result, encoding="utf-8")
remaining = result.count("### Fonts")
print(f"Done. Remaining '### Fonts' sections: {remaining}")
print(f"Total lines: {len(result.splitlines())}")
