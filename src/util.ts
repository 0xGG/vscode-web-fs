export function convertSimple2RegExpPattern(pattern: string): string {
  return (
    pattern
      .split("")
      .map((x) => x) // escape each character
      .join(".*")
      .replace(/\.\*\*+/g, ".*") + ".*"
  ).replace(/([\+\-\$\^\[\]\(\)])\.\*/g, "\\$1.*");
}
