
import { AbstractParseTreeVisitor } from "antlr4ng";


import { ProgramContext } from "./ExpressParser.js";
import { StatementContext } from "./ExpressParser.js";
import { AssignmentContext } from "./ExpressParser.js";
import { ExpressionContext } from "./ExpressParser.js";
import { ArrayContext } from "./ExpressParser.js";
import { MapContext } from "./ExpressParser.js";
import { Map_entryContext } from "./ExpressParser.js";
import { PathContext } from "./ExpressParser.js";
import { CheckContext } from "./ExpressParser.js";
import { CallContext } from "./ExpressParser.js";
import { ArgContext } from "./ExpressParser.js";
import { Named_argContext } from "./ExpressParser.js";
import { VariableContext } from "./ExpressParser.js";
import { LiteralContext } from "./ExpressParser.js";
import { IdentifierContext } from "./ExpressParser.js";
import { StringContext } from "./ExpressParser.js";


/**
 * This interface defines a complete generic visitor for a parse tree produced
 * by `ExpressParser`.
 *
 * @param <Result> The return type of the visit operation. Use `void` for
 * operations with no return type.
 */
export class ExpressVisitor<Result> extends AbstractParseTreeVisitor<Result> {
    /**
     * Visit a parse tree produced by `ExpressParser.program`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitProgram?: (ctx: ProgramContext) => Result;
    /**
     * Visit a parse tree produced by `ExpressParser.statement`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitStatement?: (ctx: StatementContext) => Result;
    /**
     * Visit a parse tree produced by `ExpressParser.assignment`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitAssignment?: (ctx: AssignmentContext) => Result;
    /**
     * Visit a parse tree produced by `ExpressParser.expression`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitExpression?: (ctx: ExpressionContext) => Result;
    /**
     * Visit a parse tree produced by `ExpressParser.array`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitArray?: (ctx: ArrayContext) => Result;
    /**
     * Visit a parse tree produced by `ExpressParser.map`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitMap?: (ctx: MapContext) => Result;
    /**
     * Visit a parse tree produced by `ExpressParser.map_entry`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitMap_entry?: (ctx: Map_entryContext) => Result;
    /**
     * Visit a parse tree produced by `ExpressParser.path`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitPath?: (ctx: PathContext) => Result;
    /**
     * Visit a parse tree produced by `ExpressParser.check`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitCheck?: (ctx: CheckContext) => Result;
    /**
     * Visit a parse tree produced by `ExpressParser.call`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitCall?: (ctx: CallContext) => Result;
    /**
     * Visit a parse tree produced by `ExpressParser.arg`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitArg?: (ctx: ArgContext) => Result;
    /**
     * Visit a parse tree produced by `ExpressParser.named_arg`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitNamed_arg?: (ctx: Named_argContext) => Result;
    /**
     * Visit a parse tree produced by `ExpressParser.variable`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitVariable?: (ctx: VariableContext) => Result;
    /**
     * Visit a parse tree produced by `ExpressParser.literal`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitLiteral?: (ctx: LiteralContext) => Result;
    /**
     * Visit a parse tree produced by `ExpressParser.identifier`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitIdentifier?: (ctx: IdentifierContext) => Result;
    /**
     * Visit a parse tree produced by `ExpressParser.string`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitString?: (ctx: StringContext) => Result;
}

