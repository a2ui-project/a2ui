# Generated from Express.g4 by ANTLR 4.13.2
# encoding: utf-8
from antlr4 import *
from io import StringIO
import sys
if sys.version_info[1] > 5:
	from typing import TextIO
else:
	from typing.io import TextIO

def serializedATN():
    return [
        4,1,24,147,2,0,7,0,2,1,7,1,2,2,7,2,2,3,7,3,2,4,7,4,2,5,7,5,2,6,7,
        6,2,7,7,7,2,8,7,8,2,9,7,9,2,10,7,10,2,11,7,11,2,12,7,12,2,13,7,13,
        1,0,5,0,30,8,0,10,0,12,0,33,9,0,1,0,1,0,1,1,1,1,3,1,39,8,1,1,2,1,
        2,3,2,43,8,2,1,2,1,2,1,2,1,3,1,3,1,3,1,3,1,3,1,3,1,3,3,3,55,8,3,
        1,4,1,4,1,4,1,4,5,4,61,8,4,10,4,12,4,64,9,4,1,4,3,4,67,8,4,3,4,69,
        8,4,1,4,1,4,1,5,1,5,1,5,1,5,5,5,77,8,5,10,5,12,5,80,9,5,1,5,3,5,
        83,8,5,3,5,85,8,5,1,5,1,5,1,6,1,6,3,6,91,8,6,1,6,1,6,1,6,1,7,1,7,
        1,8,1,8,1,8,1,8,1,8,5,8,103,8,8,10,8,12,8,106,9,8,1,8,3,8,109,8,
        8,3,8,111,8,8,1,8,3,8,114,8,8,1,9,1,9,1,9,1,9,1,9,5,9,121,8,9,10,
        9,12,9,124,9,9,1,9,3,9,127,8,9,3,9,129,8,9,1,9,1,9,1,10,1,10,3,10,
        135,8,10,1,11,1,11,1,11,1,11,3,11,141,8,11,1,12,1,12,1,13,1,13,1,
        13,0,0,14,0,2,4,6,8,10,12,14,16,18,20,22,24,26,0,1,1,0,12,15,159,
        0,31,1,0,0,0,2,38,1,0,0,0,4,42,1,0,0,0,6,54,1,0,0,0,8,56,1,0,0,0,
        10,72,1,0,0,0,12,90,1,0,0,0,14,95,1,0,0,0,16,97,1,0,0,0,18,115,1,
        0,0,0,20,134,1,0,0,0,22,140,1,0,0,0,24,142,1,0,0,0,26,144,1,0,0,
        0,28,30,3,2,1,0,29,28,1,0,0,0,30,33,1,0,0,0,31,29,1,0,0,0,31,32,
        1,0,0,0,32,34,1,0,0,0,33,31,1,0,0,0,34,35,5,0,0,1,35,1,1,0,0,0,36,
        39,3,4,2,0,37,39,3,6,3,0,38,36,1,0,0,0,38,37,1,0,0,0,39,3,1,0,0,
        0,40,43,3,24,12,0,41,43,3,14,7,0,42,40,1,0,0,0,42,41,1,0,0,0,43,
        44,1,0,0,0,44,45,5,1,0,0,45,46,3,6,3,0,46,5,1,0,0,0,47,55,3,8,4,
        0,48,55,3,10,5,0,49,55,3,14,7,0,50,55,3,16,8,0,51,55,3,18,9,0,52,
        55,3,20,10,0,53,55,3,22,11,0,54,47,1,0,0,0,54,48,1,0,0,0,54,49,1,
        0,0,0,54,50,1,0,0,0,54,51,1,0,0,0,54,52,1,0,0,0,54,53,1,0,0,0,55,
        7,1,0,0,0,56,68,5,2,0,0,57,62,3,6,3,0,58,59,5,3,0,0,59,61,3,6,3,
        0,60,58,1,0,0,0,61,64,1,0,0,0,62,60,1,0,0,0,62,63,1,0,0,0,63,66,
        1,0,0,0,64,62,1,0,0,0,65,67,5,3,0,0,66,65,1,0,0,0,66,67,1,0,0,0,
        67,69,1,0,0,0,68,57,1,0,0,0,68,69,1,0,0,0,69,70,1,0,0,0,70,71,5,
        4,0,0,71,9,1,0,0,0,72,84,5,5,0,0,73,78,3,12,6,0,74,75,5,3,0,0,75,
        77,3,12,6,0,76,74,1,0,0,0,77,80,1,0,0,0,78,76,1,0,0,0,78,79,1,0,
        0,0,79,82,1,0,0,0,80,78,1,0,0,0,81,83,5,3,0,0,82,81,1,0,0,0,82,83,
        1,0,0,0,83,85,1,0,0,0,84,73,1,0,0,0,84,85,1,0,0,0,85,86,1,0,0,0,
        86,87,5,6,0,0,87,11,1,0,0,0,88,91,3,24,12,0,89,91,3,26,13,0,90,88,
        1,0,0,0,90,89,1,0,0,0,91,92,1,0,0,0,92,93,5,7,0,0,93,94,3,6,3,0,
        94,13,1,0,0,0,95,96,5,16,0,0,96,15,1,0,0,0,97,113,5,17,0,0,98,110,
        5,8,0,0,99,104,3,6,3,0,100,101,5,3,0,0,101,103,3,6,3,0,102,100,1,
        0,0,0,103,106,1,0,0,0,104,102,1,0,0,0,104,105,1,0,0,0,105,108,1,
        0,0,0,106,104,1,0,0,0,107,109,5,3,0,0,108,107,1,0,0,0,108,109,1,
        0,0,0,109,111,1,0,0,0,110,99,1,0,0,0,110,111,1,0,0,0,111,112,1,0,
        0,0,112,114,5,9,0,0,113,98,1,0,0,0,113,114,1,0,0,0,114,17,1,0,0,
        0,115,116,3,24,12,0,116,128,5,8,0,0,117,122,3,6,3,0,118,119,5,3,
        0,0,119,121,3,6,3,0,120,118,1,0,0,0,121,124,1,0,0,0,122,120,1,0,
        0,0,122,123,1,0,0,0,123,126,1,0,0,0,124,122,1,0,0,0,125,127,5,3,
        0,0,126,125,1,0,0,0,126,127,1,0,0,0,127,129,1,0,0,0,128,117,1,0,
        0,0,128,129,1,0,0,0,129,130,1,0,0,0,130,131,5,9,0,0,131,19,1,0,0,
        0,132,135,5,10,0,0,133,135,3,24,12,0,134,132,1,0,0,0,134,133,1,0,
        0,0,135,21,1,0,0,0,136,141,3,26,13,0,137,141,5,18,0,0,138,141,5,
        19,0,0,139,141,5,11,0,0,140,136,1,0,0,0,140,137,1,0,0,0,140,138,
        1,0,0,0,140,139,1,0,0,0,141,23,1,0,0,0,142,143,5,20,0,0,143,25,1,
        0,0,0,144,145,7,0,0,0,145,27,1,0,0,0,20,31,38,42,54,62,66,68,78,
        82,84,90,104,108,110,113,122,126,128,134,140
    ]

class ExpressParser ( Parser ):

    grammarFileName = "Express.g4"

    atn = ATNDeserializer().deserialize(serializedATN())

    decisionsToDFA = [ DFA(ds, i) for i, ds in enumerate(atn.decisionToState) ]

    sharedContextCache = PredictionContextCache()

    literalNames = [ "<INVALID>", "'='", "'['", "','", "']'", "'{'", "'}'", 
                     "':'", "'('", "')'", "'_'", "'null'", "<INVALID>", 
                     "<INVALID>", "<INVALID>", "<INVALID>", "<INVALID>", 
                     "<INVALID>", "<INVALID>", "<INVALID>", "<INVALID>", 
                     "<INVALID>", "<INVALID>", "';'" ]

    symbolicNames = [ "<INVALID>", "<INVALID>", "<INVALID>", "<INVALID>", 
                      "<INVALID>", "<INVALID>", "<INVALID>", "<INVALID>", 
                      "<INVALID>", "<INVALID>", "<INVALID>", "<INVALID>", 
                      "RAW_TRIPLE_STRING", "TRIPLE_STRING", "RAW_STRING", 
                      "STANDARD_STRING", "PATH", "CHECK", "NUMBER", "BOOLEAN", 
                      "IDENTIFIER", "COMMENT", "BLOCK_COMMENT", "SEMICOLON", 
                      "WS" ]

    RULE_program = 0
    RULE_statement = 1
    RULE_assignment = 2
    RULE_expression = 3
    RULE_array = 4
    RULE_map = 5
    RULE_map_entry = 6
    RULE_path = 7
    RULE_check = 8
    RULE_call = 9
    RULE_variable = 10
    RULE_literal = 11
    RULE_identifier = 12
    RULE_string = 13

    ruleNames =  [ "program", "statement", "assignment", "expression", "array", 
                   "map", "map_entry", "path", "check", "call", "variable", 
                   "literal", "identifier", "string" ]

    EOF = Token.EOF
    T__0=1
    T__1=2
    T__2=3
    T__3=4
    T__4=5
    T__5=6
    T__6=7
    T__7=8
    T__8=9
    T__9=10
    T__10=11
    RAW_TRIPLE_STRING=12
    TRIPLE_STRING=13
    RAW_STRING=14
    STANDARD_STRING=15
    PATH=16
    CHECK=17
    NUMBER=18
    BOOLEAN=19
    IDENTIFIER=20
    COMMENT=21
    BLOCK_COMMENT=22
    SEMICOLON=23
    WS=24

    def __init__(self, input:TokenStream, output:TextIO = sys.stdout):
        super().__init__(input, output)
        self.checkVersion("4.13.2")
        self._interp = ParserATNSimulator(self, self.atn, self.decisionsToDFA, self.sharedContextCache)
        self._predicates = None




    class ProgramContext(ParserRuleContext):
        __slots__ = 'parser'

        def __init__(self, parser, parent:ParserRuleContext=None, invokingState:int=-1):
            super().__init__(parent, invokingState)
            self.parser = parser

        def EOF(self):
            return self.getToken(ExpressParser.EOF, 0)

        def statement(self, i:int=None):
            if i is None:
                return self.getTypedRuleContexts(ExpressParser.StatementContext)
            else:
                return self.getTypedRuleContext(ExpressParser.StatementContext,i)


        def getRuleIndex(self):
            return ExpressParser.RULE_program

        def accept(self, visitor:ParseTreeVisitor):
            if hasattr( visitor, "visitProgram" ):
                return visitor.visitProgram(self)
            else:
                return visitor.visitChildren(self)




    def program(self):

        localctx = ExpressParser.ProgramContext(self, self._ctx, self.state)
        self.enterRule(localctx, 0, self.RULE_program)
        self._la = 0 # Token type
        try:
            self.enterOuterAlt(localctx, 1)
            self.state = 31
            self._errHandler.sync(self)
            _la = self._input.LA(1)
            while (((_la) & ~0x3f) == 0 and ((1 << _la) & 2096164) != 0):
                self.state = 28
                self.statement()
                self.state = 33
                self._errHandler.sync(self)
                _la = self._input.LA(1)

            self.state = 34
            self.match(ExpressParser.EOF)
        except RecognitionException as re:
            localctx.exception = re
            self._errHandler.reportError(self, re)
            self._errHandler.recover(self, re)
        finally:
            self.exitRule()
        return localctx


    class StatementContext(ParserRuleContext):
        __slots__ = 'parser'

        def __init__(self, parser, parent:ParserRuleContext=None, invokingState:int=-1):
            super().__init__(parent, invokingState)
            self.parser = parser

        def assignment(self):
            return self.getTypedRuleContext(ExpressParser.AssignmentContext,0)


        def expression(self):
            return self.getTypedRuleContext(ExpressParser.ExpressionContext,0)


        def getRuleIndex(self):
            return ExpressParser.RULE_statement

        def accept(self, visitor:ParseTreeVisitor):
            if hasattr( visitor, "visitStatement" ):
                return visitor.visitStatement(self)
            else:
                return visitor.visitChildren(self)




    def statement(self):

        localctx = ExpressParser.StatementContext(self, self._ctx, self.state)
        self.enterRule(localctx, 2, self.RULE_statement)
        try:
            self.state = 38
            self._errHandler.sync(self)
            la_ = self._interp.adaptivePredict(self._input,1,self._ctx)
            if la_ == 1:
                self.enterOuterAlt(localctx, 1)
                self.state = 36
                self.assignment()
                pass

            elif la_ == 2:
                self.enterOuterAlt(localctx, 2)
                self.state = 37
                self.expression()
                pass


        except RecognitionException as re:
            localctx.exception = re
            self._errHandler.reportError(self, re)
            self._errHandler.recover(self, re)
        finally:
            self.exitRule()
        return localctx


    class AssignmentContext(ParserRuleContext):
        __slots__ = 'parser'

        def __init__(self, parser, parent:ParserRuleContext=None, invokingState:int=-1):
            super().__init__(parent, invokingState)
            self.parser = parser

        def expression(self):
            return self.getTypedRuleContext(ExpressParser.ExpressionContext,0)


        def identifier(self):
            return self.getTypedRuleContext(ExpressParser.IdentifierContext,0)


        def path(self):
            return self.getTypedRuleContext(ExpressParser.PathContext,0)


        def getRuleIndex(self):
            return ExpressParser.RULE_assignment

        def accept(self, visitor:ParseTreeVisitor):
            if hasattr( visitor, "visitAssignment" ):
                return visitor.visitAssignment(self)
            else:
                return visitor.visitChildren(self)




    def assignment(self):

        localctx = ExpressParser.AssignmentContext(self, self._ctx, self.state)
        self.enterRule(localctx, 4, self.RULE_assignment)
        try:
            self.enterOuterAlt(localctx, 1)
            self.state = 42
            self._errHandler.sync(self)
            token = self._input.LA(1)
            if token in [20]:
                self.state = 40
                self.identifier()
                pass
            elif token in [16]:
                self.state = 41
                self.path()
                pass
            else:
                raise NoViableAltException(self)

            self.state = 44
            self.match(ExpressParser.T__0)
            self.state = 45
            self.expression()
        except RecognitionException as re:
            localctx.exception = re
            self._errHandler.reportError(self, re)
            self._errHandler.recover(self, re)
        finally:
            self.exitRule()
        return localctx


    class ExpressionContext(ParserRuleContext):
        __slots__ = 'parser'

        def __init__(self, parser, parent:ParserRuleContext=None, invokingState:int=-1):
            super().__init__(parent, invokingState)
            self.parser = parser

        def array(self):
            return self.getTypedRuleContext(ExpressParser.ArrayContext,0)


        def map_(self):
            return self.getTypedRuleContext(ExpressParser.MapContext,0)


        def path(self):
            return self.getTypedRuleContext(ExpressParser.PathContext,0)


        def check(self):
            return self.getTypedRuleContext(ExpressParser.CheckContext,0)


        def call(self):
            return self.getTypedRuleContext(ExpressParser.CallContext,0)


        def variable(self):
            return self.getTypedRuleContext(ExpressParser.VariableContext,0)


        def literal(self):
            return self.getTypedRuleContext(ExpressParser.LiteralContext,0)


        def getRuleIndex(self):
            return ExpressParser.RULE_expression

        def accept(self, visitor:ParseTreeVisitor):
            if hasattr( visitor, "visitExpression" ):
                return visitor.visitExpression(self)
            else:
                return visitor.visitChildren(self)




    def expression(self):

        localctx = ExpressParser.ExpressionContext(self, self._ctx, self.state)
        self.enterRule(localctx, 6, self.RULE_expression)
        try:
            self.state = 54
            self._errHandler.sync(self)
            la_ = self._interp.adaptivePredict(self._input,3,self._ctx)
            if la_ == 1:
                self.enterOuterAlt(localctx, 1)
                self.state = 47
                self.array()
                pass

            elif la_ == 2:
                self.enterOuterAlt(localctx, 2)
                self.state = 48
                self.map_()
                pass

            elif la_ == 3:
                self.enterOuterAlt(localctx, 3)
                self.state = 49
                self.path()
                pass

            elif la_ == 4:
                self.enterOuterAlt(localctx, 4)
                self.state = 50
                self.check()
                pass

            elif la_ == 5:
                self.enterOuterAlt(localctx, 5)
                self.state = 51
                self.call()
                pass

            elif la_ == 6:
                self.enterOuterAlt(localctx, 6)
                self.state = 52
                self.variable()
                pass

            elif la_ == 7:
                self.enterOuterAlt(localctx, 7)
                self.state = 53
                self.literal()
                pass


        except RecognitionException as re:
            localctx.exception = re
            self._errHandler.reportError(self, re)
            self._errHandler.recover(self, re)
        finally:
            self.exitRule()
        return localctx


    class ArrayContext(ParserRuleContext):
        __slots__ = 'parser'

        def __init__(self, parser, parent:ParserRuleContext=None, invokingState:int=-1):
            super().__init__(parent, invokingState)
            self.parser = parser

        def expression(self, i:int=None):
            if i is None:
                return self.getTypedRuleContexts(ExpressParser.ExpressionContext)
            else:
                return self.getTypedRuleContext(ExpressParser.ExpressionContext,i)


        def getRuleIndex(self):
            return ExpressParser.RULE_array

        def accept(self, visitor:ParseTreeVisitor):
            if hasattr( visitor, "visitArray" ):
                return visitor.visitArray(self)
            else:
                return visitor.visitChildren(self)




    def array(self):

        localctx = ExpressParser.ArrayContext(self, self._ctx, self.state)
        self.enterRule(localctx, 8, self.RULE_array)
        self._la = 0 # Token type
        try:
            self.enterOuterAlt(localctx, 1)
            self.state = 56
            self.match(ExpressParser.T__1)
            self.state = 68
            self._errHandler.sync(self)
            _la = self._input.LA(1)
            if (((_la) & ~0x3f) == 0 and ((1 << _la) & 2096164) != 0):
                self.state = 57
                self.expression()
                self.state = 62
                self._errHandler.sync(self)
                _alt = self._interp.adaptivePredict(self._input,4,self._ctx)
                while _alt!=2 and _alt!=ATN.INVALID_ALT_NUMBER:
                    if _alt==1:
                        self.state = 58
                        self.match(ExpressParser.T__2)
                        self.state = 59
                        self.expression() 
                    self.state = 64
                    self._errHandler.sync(self)
                    _alt = self._interp.adaptivePredict(self._input,4,self._ctx)

                self.state = 66
                self._errHandler.sync(self)
                _la = self._input.LA(1)
                if _la==3:
                    self.state = 65
                    self.match(ExpressParser.T__2)




            self.state = 70
            self.match(ExpressParser.T__3)
        except RecognitionException as re:
            localctx.exception = re
            self._errHandler.reportError(self, re)
            self._errHandler.recover(self, re)
        finally:
            self.exitRule()
        return localctx


    class MapContext(ParserRuleContext):
        __slots__ = 'parser'

        def __init__(self, parser, parent:ParserRuleContext=None, invokingState:int=-1):
            super().__init__(parent, invokingState)
            self.parser = parser

        def map_entry(self, i:int=None):
            if i is None:
                return self.getTypedRuleContexts(ExpressParser.Map_entryContext)
            else:
                return self.getTypedRuleContext(ExpressParser.Map_entryContext,i)


        def getRuleIndex(self):
            return ExpressParser.RULE_map

        def accept(self, visitor:ParseTreeVisitor):
            if hasattr( visitor, "visitMap" ):
                return visitor.visitMap(self)
            else:
                return visitor.visitChildren(self)




    def map_(self):

        localctx = ExpressParser.MapContext(self, self._ctx, self.state)
        self.enterRule(localctx, 10, self.RULE_map)
        self._la = 0 # Token type
        try:
            self.enterOuterAlt(localctx, 1)
            self.state = 72
            self.match(ExpressParser.T__4)
            self.state = 84
            self._errHandler.sync(self)
            _la = self._input.LA(1)
            if (((_la) & ~0x3f) == 0 and ((1 << _la) & 1110016) != 0):
                self.state = 73
                self.map_entry()
                self.state = 78
                self._errHandler.sync(self)
                _alt = self._interp.adaptivePredict(self._input,7,self._ctx)
                while _alt!=2 and _alt!=ATN.INVALID_ALT_NUMBER:
                    if _alt==1:
                        self.state = 74
                        self.match(ExpressParser.T__2)
                        self.state = 75
                        self.map_entry() 
                    self.state = 80
                    self._errHandler.sync(self)
                    _alt = self._interp.adaptivePredict(self._input,7,self._ctx)

                self.state = 82
                self._errHandler.sync(self)
                _la = self._input.LA(1)
                if _la==3:
                    self.state = 81
                    self.match(ExpressParser.T__2)




            self.state = 86
            self.match(ExpressParser.T__5)
        except RecognitionException as re:
            localctx.exception = re
            self._errHandler.reportError(self, re)
            self._errHandler.recover(self, re)
        finally:
            self.exitRule()
        return localctx


    class Map_entryContext(ParserRuleContext):
        __slots__ = 'parser'

        def __init__(self, parser, parent:ParserRuleContext=None, invokingState:int=-1):
            super().__init__(parent, invokingState)
            self.parser = parser

        def expression(self):
            return self.getTypedRuleContext(ExpressParser.ExpressionContext,0)


        def identifier(self):
            return self.getTypedRuleContext(ExpressParser.IdentifierContext,0)


        def string(self):
            return self.getTypedRuleContext(ExpressParser.StringContext,0)


        def getRuleIndex(self):
            return ExpressParser.RULE_map_entry

        def accept(self, visitor:ParseTreeVisitor):
            if hasattr( visitor, "visitMap_entry" ):
                return visitor.visitMap_entry(self)
            else:
                return visitor.visitChildren(self)




    def map_entry(self):

        localctx = ExpressParser.Map_entryContext(self, self._ctx, self.state)
        self.enterRule(localctx, 12, self.RULE_map_entry)
        try:
            self.enterOuterAlt(localctx, 1)
            self.state = 90
            self._errHandler.sync(self)
            token = self._input.LA(1)
            if token in [20]:
                self.state = 88
                self.identifier()
                pass
            elif token in [12, 13, 14, 15]:
                self.state = 89
                self.string()
                pass
            else:
                raise NoViableAltException(self)

            self.state = 92
            self.match(ExpressParser.T__6)
            self.state = 93
            self.expression()
        except RecognitionException as re:
            localctx.exception = re
            self._errHandler.reportError(self, re)
            self._errHandler.recover(self, re)
        finally:
            self.exitRule()
        return localctx


    class PathContext(ParserRuleContext):
        __slots__ = 'parser'

        def __init__(self, parser, parent:ParserRuleContext=None, invokingState:int=-1):
            super().__init__(parent, invokingState)
            self.parser = parser

        def PATH(self):
            return self.getToken(ExpressParser.PATH, 0)

        def getRuleIndex(self):
            return ExpressParser.RULE_path

        def accept(self, visitor:ParseTreeVisitor):
            if hasattr( visitor, "visitPath" ):
                return visitor.visitPath(self)
            else:
                return visitor.visitChildren(self)




    def path(self):

        localctx = ExpressParser.PathContext(self, self._ctx, self.state)
        self.enterRule(localctx, 14, self.RULE_path)
        try:
            self.enterOuterAlt(localctx, 1)
            self.state = 95
            self.match(ExpressParser.PATH)
        except RecognitionException as re:
            localctx.exception = re
            self._errHandler.reportError(self, re)
            self._errHandler.recover(self, re)
        finally:
            self.exitRule()
        return localctx


    class CheckContext(ParserRuleContext):
        __slots__ = 'parser'

        def __init__(self, parser, parent:ParserRuleContext=None, invokingState:int=-1):
            super().__init__(parent, invokingState)
            self.parser = parser

        def CHECK(self):
            return self.getToken(ExpressParser.CHECK, 0)

        def expression(self, i:int=None):
            if i is None:
                return self.getTypedRuleContexts(ExpressParser.ExpressionContext)
            else:
                return self.getTypedRuleContext(ExpressParser.ExpressionContext,i)


        def getRuleIndex(self):
            return ExpressParser.RULE_check

        def accept(self, visitor:ParseTreeVisitor):
            if hasattr( visitor, "visitCheck" ):
                return visitor.visitCheck(self)
            else:
                return visitor.visitChildren(self)




    def check(self):

        localctx = ExpressParser.CheckContext(self, self._ctx, self.state)
        self.enterRule(localctx, 16, self.RULE_check)
        self._la = 0 # Token type
        try:
            self.enterOuterAlt(localctx, 1)
            self.state = 97
            self.match(ExpressParser.CHECK)
            self.state = 113
            self._errHandler.sync(self)
            _la = self._input.LA(1)
            if _la==8:
                self.state = 98
                self.match(ExpressParser.T__7)
                self.state = 110
                self._errHandler.sync(self)
                _la = self._input.LA(1)
                if (((_la) & ~0x3f) == 0 and ((1 << _la) & 2096164) != 0):
                    self.state = 99
                    self.expression()
                    self.state = 104
                    self._errHandler.sync(self)
                    _alt = self._interp.adaptivePredict(self._input,11,self._ctx)
                    while _alt!=2 and _alt!=ATN.INVALID_ALT_NUMBER:
                        if _alt==1:
                            self.state = 100
                            self.match(ExpressParser.T__2)
                            self.state = 101
                            self.expression() 
                        self.state = 106
                        self._errHandler.sync(self)
                        _alt = self._interp.adaptivePredict(self._input,11,self._ctx)

                    self.state = 108
                    self._errHandler.sync(self)
                    _la = self._input.LA(1)
                    if _la==3:
                        self.state = 107
                        self.match(ExpressParser.T__2)




                self.state = 112
                self.match(ExpressParser.T__8)


        except RecognitionException as re:
            localctx.exception = re
            self._errHandler.reportError(self, re)
            self._errHandler.recover(self, re)
        finally:
            self.exitRule()
        return localctx


    class CallContext(ParserRuleContext):
        __slots__ = 'parser'

        def __init__(self, parser, parent:ParserRuleContext=None, invokingState:int=-1):
            super().__init__(parent, invokingState)
            self.parser = parser

        def identifier(self):
            return self.getTypedRuleContext(ExpressParser.IdentifierContext,0)


        def expression(self, i:int=None):
            if i is None:
                return self.getTypedRuleContexts(ExpressParser.ExpressionContext)
            else:
                return self.getTypedRuleContext(ExpressParser.ExpressionContext,i)


        def getRuleIndex(self):
            return ExpressParser.RULE_call

        def accept(self, visitor:ParseTreeVisitor):
            if hasattr( visitor, "visitCall" ):
                return visitor.visitCall(self)
            else:
                return visitor.visitChildren(self)




    def call(self):

        localctx = ExpressParser.CallContext(self, self._ctx, self.state)
        self.enterRule(localctx, 18, self.RULE_call)
        self._la = 0 # Token type
        try:
            self.enterOuterAlt(localctx, 1)
            self.state = 115
            self.identifier()
            self.state = 116
            self.match(ExpressParser.T__7)
            self.state = 128
            self._errHandler.sync(self)
            _la = self._input.LA(1)
            if (((_la) & ~0x3f) == 0 and ((1 << _la) & 2096164) != 0):
                self.state = 117
                self.expression()
                self.state = 122
                self._errHandler.sync(self)
                _alt = self._interp.adaptivePredict(self._input,15,self._ctx)
                while _alt!=2 and _alt!=ATN.INVALID_ALT_NUMBER:
                    if _alt==1:
                        self.state = 118
                        self.match(ExpressParser.T__2)
                        self.state = 119
                        self.expression() 
                    self.state = 124
                    self._errHandler.sync(self)
                    _alt = self._interp.adaptivePredict(self._input,15,self._ctx)

                self.state = 126
                self._errHandler.sync(self)
                _la = self._input.LA(1)
                if _la==3:
                    self.state = 125
                    self.match(ExpressParser.T__2)




            self.state = 130
            self.match(ExpressParser.T__8)
        except RecognitionException as re:
            localctx.exception = re
            self._errHandler.reportError(self, re)
            self._errHandler.recover(self, re)
        finally:
            self.exitRule()
        return localctx


    class VariableContext(ParserRuleContext):
        __slots__ = 'parser'

        def __init__(self, parser, parent:ParserRuleContext=None, invokingState:int=-1):
            super().__init__(parent, invokingState)
            self.parser = parser

        def identifier(self):
            return self.getTypedRuleContext(ExpressParser.IdentifierContext,0)


        def getRuleIndex(self):
            return ExpressParser.RULE_variable

        def accept(self, visitor:ParseTreeVisitor):
            if hasattr( visitor, "visitVariable" ):
                return visitor.visitVariable(self)
            else:
                return visitor.visitChildren(self)




    def variable(self):

        localctx = ExpressParser.VariableContext(self, self._ctx, self.state)
        self.enterRule(localctx, 20, self.RULE_variable)
        try:
            self.state = 134
            self._errHandler.sync(self)
            token = self._input.LA(1)
            if token in [10]:
                self.enterOuterAlt(localctx, 1)
                self.state = 132
                self.match(ExpressParser.T__9)
                pass
            elif token in [20]:
                self.enterOuterAlt(localctx, 2)
                self.state = 133
                self.identifier()
                pass
            else:
                raise NoViableAltException(self)

        except RecognitionException as re:
            localctx.exception = re
            self._errHandler.reportError(self, re)
            self._errHandler.recover(self, re)
        finally:
            self.exitRule()
        return localctx


    class LiteralContext(ParserRuleContext):
        __slots__ = 'parser'

        def __init__(self, parser, parent:ParserRuleContext=None, invokingState:int=-1):
            super().__init__(parent, invokingState)
            self.parser = parser

        def string(self):
            return self.getTypedRuleContext(ExpressParser.StringContext,0)


        def NUMBER(self):
            return self.getToken(ExpressParser.NUMBER, 0)

        def BOOLEAN(self):
            return self.getToken(ExpressParser.BOOLEAN, 0)

        def getRuleIndex(self):
            return ExpressParser.RULE_literal

        def accept(self, visitor:ParseTreeVisitor):
            if hasattr( visitor, "visitLiteral" ):
                return visitor.visitLiteral(self)
            else:
                return visitor.visitChildren(self)




    def literal(self):

        localctx = ExpressParser.LiteralContext(self, self._ctx, self.state)
        self.enterRule(localctx, 22, self.RULE_literal)
        try:
            self.state = 140
            self._errHandler.sync(self)
            token = self._input.LA(1)
            if token in [12, 13, 14, 15]:
                self.enterOuterAlt(localctx, 1)
                self.state = 136
                self.string()
                pass
            elif token in [18]:
                self.enterOuterAlt(localctx, 2)
                self.state = 137
                self.match(ExpressParser.NUMBER)
                pass
            elif token in [19]:
                self.enterOuterAlt(localctx, 3)
                self.state = 138
                self.match(ExpressParser.BOOLEAN)
                pass
            elif token in [11]:
                self.enterOuterAlt(localctx, 4)
                self.state = 139
                self.match(ExpressParser.T__10)
                pass
            else:
                raise NoViableAltException(self)

        except RecognitionException as re:
            localctx.exception = re
            self._errHandler.reportError(self, re)
            self._errHandler.recover(self, re)
        finally:
            self.exitRule()
        return localctx


    class IdentifierContext(ParserRuleContext):
        __slots__ = 'parser'

        def __init__(self, parser, parent:ParserRuleContext=None, invokingState:int=-1):
            super().__init__(parent, invokingState)
            self.parser = parser

        def IDENTIFIER(self):
            return self.getToken(ExpressParser.IDENTIFIER, 0)

        def getRuleIndex(self):
            return ExpressParser.RULE_identifier

        def accept(self, visitor:ParseTreeVisitor):
            if hasattr( visitor, "visitIdentifier" ):
                return visitor.visitIdentifier(self)
            else:
                return visitor.visitChildren(self)




    def identifier(self):

        localctx = ExpressParser.IdentifierContext(self, self._ctx, self.state)
        self.enterRule(localctx, 24, self.RULE_identifier)
        try:
            self.enterOuterAlt(localctx, 1)
            self.state = 142
            self.match(ExpressParser.IDENTIFIER)
        except RecognitionException as re:
            localctx.exception = re
            self._errHandler.reportError(self, re)
            self._errHandler.recover(self, re)
        finally:
            self.exitRule()
        return localctx


    class StringContext(ParserRuleContext):
        __slots__ = 'parser'

        def __init__(self, parser, parent:ParserRuleContext=None, invokingState:int=-1):
            super().__init__(parent, invokingState)
            self.parser = parser

        def RAW_TRIPLE_STRING(self):
            return self.getToken(ExpressParser.RAW_TRIPLE_STRING, 0)

        def TRIPLE_STRING(self):
            return self.getToken(ExpressParser.TRIPLE_STRING, 0)

        def RAW_STRING(self):
            return self.getToken(ExpressParser.RAW_STRING, 0)

        def STANDARD_STRING(self):
            return self.getToken(ExpressParser.STANDARD_STRING, 0)

        def getRuleIndex(self):
            return ExpressParser.RULE_string

        def accept(self, visitor:ParseTreeVisitor):
            if hasattr( visitor, "visitString" ):
                return visitor.visitString(self)
            else:
                return visitor.visitChildren(self)




    def string(self):

        localctx = ExpressParser.StringContext(self, self._ctx, self.state)
        self.enterRule(localctx, 26, self.RULE_string)
        self._la = 0 # Token type
        try:
            self.enterOuterAlt(localctx, 1)
            self.state = 144
            _la = self._input.LA(1)
            if not((((_la) & ~0x3f) == 0 and ((1 << _la) & 61440) != 0)):
                self._errHandler.recoverInline(self)
            else:
                self._errHandler.reportMatch(self)
                self.consume()
        except RecognitionException as re:
            localctx.exception = re
            self._errHandler.reportError(self, re)
            self._errHandler.recover(self, re)
        finally:
            self.exitRule()
        return localctx





