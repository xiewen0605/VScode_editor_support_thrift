import { TextDocument } from "vscode-languageserver-textdocument";

import {
  ThriftDocument,
  ThriftStatement,
  SyntaxType,
  TextLocation,
  IncludeDefinition,
} from "./thrift-parse";
import { TextDocuments } from "vscode-languageserver";

export interface IncludeNode extends IncludeDefinition {
  filePath: string;
  fileName: string;
  raw?: string;
}

export type filterFnType = (item: ThriftStatement, index: number) => any;

export type GetReturnType<original> = original extends (
  ...x: any[]
) => infer returnType
  ? returnType
  : never;

// 筛选出 AST 节点中 name.value 与给定单词 word 匹配的节点。
// 查找 Thrift 中指定单词（如类型名、变量名）相关的 AST 节点。
export const wordNodeFilter =
  (word: string) => (item: ThriftStatement, index: number) => {
    if (
      item.type !== SyntaxType.IncludeDefinition &&
      item.type !== SyntaxType.CppIncludeDefinition &&
      item.name.value === word
    ) {
      return item;
    }
  };

// 筛选出 Thrift 文件中所有的 include 语句节点。
// 用于收集 Thrift 文件中的 include 依赖关系。
export const includeNodeFilter =
  () => (item: ThriftStatement, index: number) => {
    if (item.type === SyntaxType.IncludeDefinition) {
      return item;
    }
  };

// 将一基的行号或位置转换为零基，方便与程序中的索引对齐。
// AST 操作或文档操作时，通常需要零基索引。
export const genZeroBasedNum = (num: number) => num - 1;


// 将相对路径解析为绝对路径。
// 处理 .. 和 . 等相对路径符号。
// 返回基于 basePath 计算出的完整路径。
// 处理 Thrift 文件中的 include 指令时，将相对路径解析为绝对路径，方便进一步操作。
export function resolvePath(basePath, relativePath) {
  const baseParts = basePath.split('/').slice(0, -1); // 获取 basePath 的目录部分
  const relativeParts = relativePath.split('/');
  
  for (const part of relativeParts) {
    if (part === '..') {
      baseParts.pop();
    } else if (part !== '.') {
      baseParts.push(part);
    }
  }

  return baseParts.join('/');
}

export class ASTHelper {
  ast: ThriftDocument;
  document: TextDocument;
  filePath: string;
  documents: TextDocuments<TextDocument>;
  readonly includeNodes: IncludeNode[];
  constructor(
    ast: ThriftDocument,
    document: TextDocument,
    filePath: string,
    documents: TextDocuments<TextDocument>
  ) {
    this.ast = ast;
    this.document = document;
    this.documents = documents;
    this.filePath = filePath;
    this.includeNodes = this.getIncludeNodes();
  }

  // 筛选出所有 include 节点。
  // 将 include 的路径转换为绝对路径并存储。
  getIncludeNodes() {
    const includeNodes = this.filter(
      includeNodeFilter()
    ) as IncludeDefinition[];
    return includeNodes.map((item) => {
      const { path: includePath } = item;
      const fileName = includePath.value;
      const newPath = resolvePath(this.filePath, fileName);
        return {
          ...item,
          fileName,
          filePath: newPath
        };
    });
  }

  // 对 AST 的 body 节点数组应用给定的过滤函数，返回匹配的节点。
  filter = <fn extends filterFnType>(originalFn: fn) => {
    const result = this.ast.body.filter(originalFn) as GetReturnType<fn>[];
    return result;
  };

  // 查找指定类型（targetTypeName）在 AST 中的所有引用。
  findReferences = (ast, targetTypeName: string) => {
    const references = [];
    for (let i = 0; i < ast.body.length; i++) {
      const p1Node = ast.body[i];      
      if (p1Node.fields) {
        p1Node.fields.forEach(cur => {  
          if (cur.fieldType.type === "Identifier" && cur.fieldType?.value === targetTypeName) {
            references.push(cur.fieldType); 
          }
          if (cur.fieldType.type === "ListType" || cur.fieldType.type === "MapType") {
            const getNode = this.recurGetNode(cur.fieldType, targetTypeName);
            getNode && references.push(getNode);
          }
        })
      }      
      if (p1Node.functions) {
        p1Node.functions.forEach(cur => {          
          if (cur.type === "FunctionDefinition") {
            cur.fields.forEach(item => {
              if (item.type === "FieldDefinition" && item.fieldType.value === targetTypeName) {
                references.push(item.fieldType);
              }
              if (item.fieldType.type === "ListType" || item.fieldType.type === "MapType") {
                const getNode = this.recurGetNode(cur.fieldType, targetTypeName);
                getNode && references.push(getNode);
              }
            })
          }
          
          if (cur.returnType && cur.returnType.value === targetTypeName) {
            references.push(cur.returnType);
          }
        })
      }
    }
    return references
  };

  // 递归检查列表、映射等嵌套类型，查找目标类型节点。
  recurGetNode = (node: any, targetName: string) => {
    if (node.type === "Identifier" && node?.value === targetName) {
      return node;
    }
    if ((node .type === "ListType" || node .type === "MapType") && node.valueType) {
      return this.recurGetNode(node.valueType, targetName)
    }
    return null;
  }

  findNodeByWord = (word: string) => {
    return this.filter(wordNodeFilter(word))[0];
  };

  findNodesByInput = (input: string) => {
    return this.filter((item, index) => {
      if (
        item.type !== SyntaxType.IncludeDefinition &&
        item.type !== SyntaxType.CppIncludeDefinition &&
        item.type !== SyntaxType.NamespaceDefinition &&
        item.name.value
          .toLocaleUpperCase()
          .includes(input.trim().toLocaleUpperCase())
      ) {
        return item;
      }
    });
  };
}

