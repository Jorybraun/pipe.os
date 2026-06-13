import ast
import json
import sys


def byte_line_starts(source_bytes: bytes) -> list[int]:
    starts = [0]
    for index, value in enumerate(source_bytes):
        if value == 10:
            starts.append(index + 1)
    return starts


def byte_range(node: ast.AST, starts: list[int]) -> tuple[int, int]:
    start_line = max(1, getattr(node, "lineno", 1))
    end_line = max(start_line, getattr(node, "end_lineno", start_line))
    start = starts[start_line - 1] + getattr(node, "col_offset", 0)
    end = starts[end_line - 1] + getattr(node, "end_col_offset", 0)
    return start, max(start + 1, end)


def call_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        prefix = call_name(node.value)
        return f"{prefix}.{node.attr}" if prefix else node.attr
    return ""


def main() -> None:
    payload = json.load(sys.stdin)
    path = payload["path"]
    source = payload["content"]
    source_bytes = source.encode("utf-8")
    starts = byte_line_starts(source_bytes)
    tree = ast.parse(source, filename=path, type_comments=True)
    declarations = [{
        "kind": "module",
        "name": path,
        "qualifiedName": path,
        "startByte": 0,
        "endByte": max(1, len(source_bytes)),
        "startLine": 1,
        "endLine": max(1, len(source.splitlines())),
        "parentQualifiedName": None,
    }]
    facts = []
    scope = [path]

    class Visitor(ast.NodeVisitor):
        def add_declaration(self, node: ast.AST, kind: str, name: str) -> None:
            start, end = byte_range(node, starts)
            qualified = ".".join([*scope, name])
            declarations.append({
                "kind": kind,
                "name": name,
                "qualifiedName": qualified,
                "startByte": start,
                "endByte": end,
                "startLine": getattr(node, "lineno", 1),
                "endLine": getattr(node, "end_lineno", getattr(node, "lineno", 1)),
                "parentQualifiedName": ".".join(scope),
            })

        def visit_ClassDef(self, node: ast.ClassDef) -> None:
            self.add_declaration(node, "class", node.name)
            scope.append(node.name)
            self.generic_visit(node)
            scope.pop()

        def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
            kind = "method" if len(scope) > 1 else "function"
            self.add_declaration(node, kind, node.name)
            scope.append(node.name)
            self.generic_visit(node)
            scope.pop()

        def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
            self.visit_FunctionDef(node)

        def visit_Import(self, node: ast.Import) -> None:
            start, end = byte_range(node, starts)
            for alias in node.names:
                facts.append({
                    "kind": "imports",
                    "subjectQualifiedName": ".".join(scope),
                    "objectConcept": alias.name,
                    "startByte": start,
                    "endByte": end,
                })
            self.generic_visit(node)

        def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
            start, end = byte_range(node, starts)
            module = node.module or ""
            for alias in node.names:
                imported = f"{module}.{alias.name}".strip(".")
                facts.append({
                    "kind": "imports",
                    "subjectQualifiedName": ".".join(scope),
                    "objectConcept": imported,
                    "startByte": start,
                    "endByte": end,
                })
            self.generic_visit(node)

        def visit_Call(self, node: ast.Call) -> None:
            target = call_name(node.func)
            if target:
                start, end = byte_range(node, starts)
                facts.append({
                    "kind": "calls",
                    "subjectQualifiedName": ".".join(scope),
                    "objectConcept": target,
                    "startByte": start,
                    "endByte": end,
                })
            self.generic_visit(node)

    Visitor().visit(tree)
    json.dump({"declarations": declarations, "facts": facts}, sys.stdout)


if __name__ == "__main__":
    main()
