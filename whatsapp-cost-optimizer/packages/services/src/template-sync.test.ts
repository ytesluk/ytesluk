import { describe, expect, it } from "vitest";
import { templateVariables, toLocalComponents } from "./template-sync";

describe("template sync conversion", () => {
  it("extracts named and positional body variables in send order", () => {
    expect(templateVariables("Olá {{nome}}, pedido {{ pedido }} — {{nome}}")).toEqual(["nome", "pedido"]);
    const pos = toLocalComponents({ id: "1", name: "t", language: "pt_BR", status: "APPROVED", category: "UTILITY", parameterFormat: "POSITIONAL", components: [{ type: "BODY", text: "{{2}} e {{1}}" }] });
    expect(pos.params).toEqual(["1", "2"]);
    expect(pos.components[0]).toMatchObject({ type: "BODY", params: ["1", "2"], parameterFormat: "POSITIONAL" });
    const named = toLocalComponents({ id: "2", name: "t", language: "pt_BR", status: "APPROVED", category: "UTILITY", parameterFormat: "NAMED", components: [{ type: "BODY", text: "Pedido {{order_id}}" }] });
    expect(named.components[0]).toMatchObject({ params: ["order_id"], parameterFormat: "NAMED" });
  });

  it("infers the format when Meta omits parameter_format and flags header variables", () => {
    const legacy = toLocalComponents({ id: "3", name: "t", language: "en_US", status: "APPROVED", category: "MARKETING", components: [{ type: "HEADER", format: "TEXT", text: "Oi {{1}}" }, { type: "BODY", text: "Código {{1}}" }] });
    expect(legacy.components[1]).toMatchObject({ parameterFormat: "POSITIONAL" });
    expect(legacy.unsupportedVariables).toBe(true);
  });
});
