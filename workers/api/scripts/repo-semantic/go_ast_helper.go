package main

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
)

type input struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type declaration struct {
	Kind                string  `json:"kind"`
	Name                string  `json:"name"`
	QualifiedName       string  `json:"qualifiedName"`
	StartByte           int     `json:"startByte"`
	EndByte             int     `json:"endByte"`
	StartLine           int     `json:"startLine"`
	EndLine             int     `json:"endLine"`
	ParentQualifiedName *string `json:"parentQualifiedName"`
}

type fact struct {
	Kind                 string `json:"kind"`
	SubjectQualifiedName string `json:"subjectQualifiedName"`
	ObjectConcept        string `json:"objectConcept"`
	StartByte            int    `json:"startByte"`
	EndByte              int    `json:"endByte"`
}

type output struct {
	Declarations []declaration `json:"declarations"`
	Facts        []fact        `json:"facts"`
}

func expressionName(expression ast.Expr) string {
	switch node := expression.(type) {
	case *ast.Ident:
		return node.Name
	case *ast.SelectorExpr:
		prefix := expressionName(node.X)
		if prefix == "" {
			return node.Sel.Name
		}
		return prefix + "." + node.Sel.Name
	}
	return ""
}

func main() {
	var payload input
	if err := json.NewDecoder(os.Stdin).Decode(&payload); err != nil {
		panic(err)
	}
	files := token.NewFileSet()
	file, err := parser.ParseFile(files, payload.Path, payload.Content, parser.ParseComments)
	if err != nil {
		panic(err)
	}
	result := output{}
	module := payload.Path
	if file.Name != nil && file.Name.Name != "" {
		module = file.Name.Name
	}
	result.Declarations = append(result.Declarations, declaration{
		Kind: "module", Name: module, QualifiedName: payload.Path,
		StartByte: 0, EndByte: len([]byte(payload.Content)),
		StartLine: 1, EndLine: strings.Count(payload.Content, "\n") + 1,
	})
	scope := payload.Path
	for _, item := range file.Decls {
		switch node := item.(type) {
		case *ast.FuncDecl:
			kind := "function"
			if node.Recv != nil {
				kind = "method"
			}
			parent := scope
			result.Declarations = append(result.Declarations, declaration{
				Kind: kind, Name: node.Name.Name,
				QualifiedName:       scope + "." + node.Name.Name,
				StartByte:           files.Position(node.Pos()).Offset,
				EndByte:             files.Position(node.End()).Offset,
				StartLine:           files.Position(node.Pos()).Line,
				EndLine:             files.Position(node.End()).Line,
				ParentQualifiedName: &parent,
			})
		case *ast.GenDecl:
			for _, specification := range node.Specs {
				typeSpec, ok := specification.(*ast.TypeSpec)
				if !ok {
					continue
				}
				kind := "type"
				switch typeSpec.Type.(type) {
				case *ast.StructType:
					kind = "class"
				case *ast.InterfaceType:
					kind = "interface"
				}
				parent := scope
				result.Declarations = append(result.Declarations, declaration{
					Kind: kind, Name: typeSpec.Name.Name,
					QualifiedName:       scope + "." + typeSpec.Name.Name,
					StartByte:           files.Position(typeSpec.Pos()).Offset,
					EndByte:             files.Position(typeSpec.End()).Offset,
					StartLine:           files.Position(typeSpec.Pos()).Line,
					EndLine:             files.Position(typeSpec.End()).Line,
					ParentQualifiedName: &parent,
				})
			}
		}
	}
	for _, imported := range file.Imports {
		value := strings.Trim(imported.Path.Value, "\"")
		result.Facts = append(result.Facts, fact{
			Kind: "imports", SubjectQualifiedName: scope, ObjectConcept: value,
			StartByte: files.Position(imported.Pos()).Offset,
			EndByte:   files.Position(imported.End()).Offset,
		})
	}
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		target := expressionName(call.Fun)
		if target != "" {
			result.Facts = append(result.Facts, fact{
				Kind: "calls", SubjectQualifiedName: scope, ObjectConcept: target,
				StartByte: files.Position(call.Pos()).Offset,
				EndByte:   files.Position(call.End()).Offset,
			})
		}
		return true
	})
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		panic(err)
	}
}
