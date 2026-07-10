# Generated from Express.g4 by ANTLR 4.13.2
from antlr4 import *
if "." in __name__:
    from .express_parser import ExpressParser
else:
    from .express_parser import ExpressParser

# This class defines a complete generic visitor for a parse tree produced by ExpressParser.

class ExpressVisitor(ParseTreeVisitor):

    # Visit a parse tree produced by ExpressParser#program.
    def visitProgram(self, ctx:ExpressParser.ProgramContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by ExpressParser#statement.
    def visitStatement(self, ctx:ExpressParser.StatementContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by ExpressParser#assignment.
    def visitAssignment(self, ctx:ExpressParser.AssignmentContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by ExpressParser#expression.
    def visitExpression(self, ctx:ExpressParser.ExpressionContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by ExpressParser#array.
    def visitArray(self, ctx:ExpressParser.ArrayContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by ExpressParser#map.
    def visitMap(self, ctx:ExpressParser.MapContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by ExpressParser#map_entry.
    def visitMap_entry(self, ctx:ExpressParser.Map_entryContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by ExpressParser#path.
    def visitPath(self, ctx:ExpressParser.PathContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by ExpressParser#check.
    def visitCheck(self, ctx:ExpressParser.CheckContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by ExpressParser#call.
    def visitCall(self, ctx:ExpressParser.CallContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by ExpressParser#variable.
    def visitVariable(self, ctx:ExpressParser.VariableContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by ExpressParser#literal.
    def visitLiteral(self, ctx:ExpressParser.LiteralContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by ExpressParser#identifier.
    def visitIdentifier(self, ctx:ExpressParser.IdentifierContext):
        return self.visitChildren(ctx)


    # Visit a parse tree produced by ExpressParser#string.
    def visitString(self, ctx:ExpressParser.StringContext):
        return self.visitChildren(ctx)



del ExpressParser