export type FormValue = string | number | boolean | null | undefined | FormValue[] | { [key: string]: FormValue };

function appendValue(params: URLSearchParams, path: string, value: FormValue): void {
  if (value === undefined) {
    return;
  }

  if (value === null) {
    params.append(path, "");
    return;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    params.append(path, String(value));
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => appendValue(params, `${path}[${index}]`, item));
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    appendValue(params, path === "" ? key : `${path}[${key}]`, item);
  }
}

/** Serializes nested values in the bracket notation Laravel/PHP expects. */
export function toFormBody(value: object): string {
  const params = new URLSearchParams();
  appendValue(params, "", value as FormValue);
  return params.toString();
}
