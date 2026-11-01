import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaTransformation from "effect/SchemaTransformation";

export const decodeJsonResult = <S extends Schema.Codec<unknown, unknown, never, never>>(
  schema: S,
) => {
  const decode = Schema.decodeExit(Schema.fromJsonString(schema));
  return (input: string) => {
    const result = decode(input);
    if (Exit.isFailure(result)) {
      return Result.fail(result.cause);
    }
    return Result.succeed(result.value);
  };
};

const decodeJsonString = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

// One linear pass: a regex over string literals backtracks quadratically on unterminated strings.
function stripJsonComments(input: string): string {
  const out: string[] = [];
  let trailingComma = -1;
  let index = 0;
  while (index < input.length) {
    const char = input[index]!;
    if (char === '"') {
      let end = index + 1;
      while (end < input.length && input[end] !== '"') end += input[end] === "\\" ? 2 : 1;
      out.push(input.slice(index, end + 1));
      trailingComma = -1;
      index = end + 1;
      continue;
    }
    if (char === "/" && input[index + 1] === "/") {
      let end = index + 2;
      while (end < input.length && input[end] !== "\n" && input[end] !== "\r") end += 1;
      out.push(" ");
      index = end;
      continue;
    }
    if (char === "/" && input[index + 1] === "*") {
      const end = input.indexOf("*/", index + 2);
      if (end >= 0) {
        // Whitespace keeps adjacent tokens apart.
        out.push(" ");
        index = end + 2;
        continue;
      }
    }
    if ((char === "}" || char === "]") && trailingComma >= 0) out[trailingComma] = "";
    if (char === ",") trailingComma = out.length;
    else if (!/\s/.test(char)) trailingComma = -1;
    out.push(char);
    index += 1;
  }
  return out.join("");
}

const parseLenientJsonGetter = SchemaGetter.transformEffect((input: string) =>
  decodeJsonString(stripJsonComments(input)).pipe(Effect.mapError((error) => error.issue)),
);

const fromLenientJsonString = new SchemaTransformation.Transformation(
  parseLenientJsonGetter,
  SchemaGetter.stringifyJson(),
);

const prettyJsonString = SchemaGetter.parseJson<string>().pipe(
  SchemaGetter.compose(SchemaGetter.stringifyJson({ space: 2 })),
);

export const fromLenientJson = <S extends Schema.Top>(schema: S) =>
  Schema.String.pipe(Schema.decodeTo(schema, fromLenientJsonString));

export function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  if (start < 0) {
    return trimmed;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(start, index + 1);
      }
    }
  }

  return trimmed.slice(start);
}

export const fromJsonStringPretty = <S extends Schema.Top>(schema: S) =>
  Schema.fromJsonString(schema).pipe(
    Schema.encode({
      decode: prettyJsonString,
      encode: prettyJsonString,
    }),
  );
