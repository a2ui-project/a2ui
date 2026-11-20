
import * as antlr from "antlr4ng";
import { Token } from "antlr4ng";

import { ExpressVisitor } from "./ExpressVisitor.js";

// for running tests with parameters, TODO: discuss strategy for typed parameters in CI
// eslint-disable-next-line no-unused-vars
type int = number;


export class ExpressParser extends antlr.Parser {
    public static readonly T__0 = 1;
    public static readonly T__1 = 2;
    public static readonly T__2 = 3;
    public static readonly T__3 = 4;
    public static readonly T__4 = 5;
    public static readonly T__5 = 6;
    public static readonly T__6 = 7;
    public static readonly T__7 = 8;
    public static readonly T__8 = 9;
    public static readonly T__9 = 10;
    public static readonly T__10 = 11;
    public static readonly RAW_TRIPLE_STRING = 12;
    public static readonly TRIPLE_STRING = 13;
    public static readonly RAW_STRING = 14;
    public static readonly STANDARD_STRING = 15;
    public static readonly PATH = 16;
    public static readonly CHECK = 17;
    public static readonly NUMBER = 18;
    public static readonly BOOLEAN = 19;
    public static readonly IDENTIFIER = 20;
    public static readonly SYSTEM_IDENTIFIER = 21;
    public static readonly COMMENT = 22;
    public static readonly BLOCK_COMMENT = 23;
    public static readonly SEMICOLON = 24;
    public static readonly WS = 25;
    public static readonly RULE_program = 0;
    public static readonly RULE_statement = 1;
    public static readonly RULE_assignment = 2;
    public static readonly RULE_expression = 3;
    public static readonly RULE_array = 4;
    public static readonly RULE_map = 5;
    public static readonly RULE_map_entry = 6;
    public static readonly RULE_path = 7;
    public static readonly RULE_check = 8;
    public static readonly RULE_call = 9;
    public static readonly RULE_function_name = 10;
    public static readonly RULE_arg = 11;
    public static readonly RULE_named_arg = 12;
    public static readonly RULE_variable = 13;
    public static readonly RULE_literal = 14;
    public static readonly RULE_identifier = 15;
    public static readonly RULE_string = 16;

    public static readonly literalNames = [
        null, "'='", "'['", "','", "']'", "'{'", "'}'", "':'", "'('", "')'", 
        "'_'", "'null'", null, null, null, null, null, null, null, null, 
        null, null, null, null, "';'"
    ];

    public static readonly symbolicNames = [
        null, null, null, null, null, null, null, null, null, null, null, 
        null, "RAW_TRIPLE_STRING", "TRIPLE_STRING", "RAW_STRING", "STANDARD_STRING", 
        "PATH", "CHECK", "NUMBER", "BOOLEAN", "IDENTIFIER", "SYSTEM_IDENTIFIER", 
        "COMMENT", "BLOCK_COMMENT", "SEMICOLON", "WS"
    ];
    public static readonly ruleNames = [
        "program", "statement", "assignment", "expression", "array", "map", 
        "map_entry", "path", "check", "call", "function_name", "arg", "named_arg", 
        "variable", "literal", "identifier", "string",
    ];

    public get grammarFileName(): string { return "Express.g4"; }
    public get literalNames(): (string | null)[] { return ExpressParser.literalNames; }
    public get symbolicNames(): (string | null)[] { return ExpressParser.symbolicNames; }
    public get ruleNames(): string[] { return ExpressParser.ruleNames; }
    public get serializedATN(): number[] { return ExpressParser._serializedATN; }

    protected createFailedPredicateException(predicate?: string, message?: string): antlr.FailedPredicateException {
        return new antlr.FailedPredicateException(this, predicate, message);
    }

    public constructor(input: antlr.TokenStream) {
        super(input);
        this.interpreter = new antlr.ParserATNSimulator(this, ExpressParser._ATN, ExpressParser.decisionsToDFA, new antlr.PredictionContextCache());
    }
    public program(): ProgramContext {
        let localContext = new ProgramContext(this.context, this.state);
        this.enterRule(localContext, 0, ExpressParser.RULE_program);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 37;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 4193316) !== 0)) {
                {
                {
                this.state = 34;
                this.statement();
                }
                }
                this.state = 39;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
            }
            this.state = 40;
            this.match(ExpressParser.EOF);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public statement(): StatementContext {
        let localContext = new StatementContext(this.context, this.state);
        this.enterRule(localContext, 2, ExpressParser.RULE_statement);
        try {
            this.state = 44;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 1, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 42;
                this.assignment();
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 43;
                this.expression();
                }
                break;
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public assignment(): AssignmentContext {
        let localContext = new AssignmentContext(this.context, this.state);
        this.enterRule(localContext, 4, ExpressParser.RULE_assignment);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 48;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case ExpressParser.IDENTIFIER:
                {
                this.state = 46;
                this.identifier();
                }
                break;
            case ExpressParser.PATH:
                {
                this.state = 47;
                this.path();
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
            this.state = 50;
            this.match(ExpressParser.T__0);
            this.state = 51;
            this.expression();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public expression(): ExpressionContext {
        let localContext = new ExpressionContext(this.context, this.state);
        this.enterRule(localContext, 6, ExpressParser.RULE_expression);
        try {
            this.state = 60;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 3, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 53;
                this.array();
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 54;
                this.map();
                }
                break;
            case 3:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 55;
                this.path();
                }
                break;
            case 4:
                this.enterOuterAlt(localContext, 4);
                {
                this.state = 56;
                this.check();
                }
                break;
            case 5:
                this.enterOuterAlt(localContext, 5);
                {
                this.state = 57;
                this.call();
                }
                break;
            case 6:
                this.enterOuterAlt(localContext, 6);
                {
                this.state = 58;
                this.variable();
                }
                break;
            case 7:
                this.enterOuterAlt(localContext, 7);
                {
                this.state = 59;
                this.literal();
                }
                break;
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public array(): ArrayContext {
        let localContext = new ArrayContext(this.context, this.state);
        this.enterRule(localContext, 8, ExpressParser.RULE_array);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 62;
            this.match(ExpressParser.T__1);
            this.state = 74;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if ((((_la) & ~0x1F) === 0 && ((1 << _la) & 4193316) !== 0)) {
                {
                this.state = 63;
                this.expression();
                this.state = 68;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 4, this.context);
                while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                    if (alternative === 1) {
                        {
                        {
                        this.state = 64;
                        this.match(ExpressParser.T__2);
                        this.state = 65;
                        this.expression();
                        }
                        }
                    }
                    this.state = 70;
                    this.errorHandler.sync(this);
                    alternative = this.interpreter.adaptivePredict(this.tokenStream, 4, this.context);
                }
                this.state = 72;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 3) {
                    {
                    this.state = 71;
                    this.match(ExpressParser.T__2);
                    }
                }

                }
            }

            this.state = 76;
            this.match(ExpressParser.T__3);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public map(): MapContext {
        let localContext = new MapContext(this.context, this.state);
        this.enterRule(localContext, 10, ExpressParser.RULE_map);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 78;
            this.match(ExpressParser.T__4);
            this.state = 90;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if ((((_la) & ~0x1F) === 0 && ((1 << _la) & 1110016) !== 0)) {
                {
                this.state = 79;
                this.map_entry();
                this.state = 84;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 7, this.context);
                while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                    if (alternative === 1) {
                        {
                        {
                        this.state = 80;
                        this.match(ExpressParser.T__2);
                        this.state = 81;
                        this.map_entry();
                        }
                        }
                    }
                    this.state = 86;
                    this.errorHandler.sync(this);
                    alternative = this.interpreter.adaptivePredict(this.tokenStream, 7, this.context);
                }
                this.state = 88;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 3) {
                    {
                    this.state = 87;
                    this.match(ExpressParser.T__2);
                    }
                }

                }
            }

            this.state = 92;
            this.match(ExpressParser.T__5);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public map_entry(): Map_entryContext {
        let localContext = new Map_entryContext(this.context, this.state);
        this.enterRule(localContext, 12, ExpressParser.RULE_map_entry);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 96;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case ExpressParser.IDENTIFIER:
                {
                this.state = 94;
                this.identifier();
                }
                break;
            case ExpressParser.RAW_TRIPLE_STRING:
            case ExpressParser.TRIPLE_STRING:
            case ExpressParser.RAW_STRING:
            case ExpressParser.STANDARD_STRING:
                {
                this.state = 95;
                this.string_();
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
            this.state = 98;
            this.match(ExpressParser.T__6);
            this.state = 99;
            this.expression();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public path(): PathContext {
        let localContext = new PathContext(this.context, this.state);
        this.enterRule(localContext, 14, ExpressParser.RULE_path);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 101;
            this.match(ExpressParser.PATH);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public check(): CheckContext {
        let localContext = new CheckContext(this.context, this.state);
        this.enterRule(localContext, 16, ExpressParser.RULE_check);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 103;
            this.match(ExpressParser.CHECK);
            this.state = 119;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 8) {
                {
                this.state = 104;
                this.match(ExpressParser.T__7);
                this.state = 116;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if ((((_la) & ~0x1F) === 0 && ((1 << _la) & 4193316) !== 0)) {
                    {
                    this.state = 105;
                    this.expression();
                    this.state = 110;
                    this.errorHandler.sync(this);
                    alternative = this.interpreter.adaptivePredict(this.tokenStream, 11, this.context);
                    while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                        if (alternative === 1) {
                            {
                            {
                            this.state = 106;
                            this.match(ExpressParser.T__2);
                            this.state = 107;
                            this.expression();
                            }
                            }
                        }
                        this.state = 112;
                        this.errorHandler.sync(this);
                        alternative = this.interpreter.adaptivePredict(this.tokenStream, 11, this.context);
                    }
                    this.state = 114;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 3) {
                        {
                        this.state = 113;
                        this.match(ExpressParser.T__2);
                        }
                    }

                    }
                }

                this.state = 118;
                this.match(ExpressParser.T__8);
                }
            }

            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public call(): CallContext {
        let localContext = new CallContext(this.context, this.state);
        this.enterRule(localContext, 18, ExpressParser.RULE_call);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 121;
            this.function_name();
            this.state = 122;
            this.match(ExpressParser.T__7);
            this.state = 134;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if ((((_la) & ~0x1F) === 0 && ((1 << _la) & 4193316) !== 0)) {
                {
                this.state = 123;
                this.arg();
                this.state = 128;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 15, this.context);
                while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                    if (alternative === 1) {
                        {
                        {
                        this.state = 124;
                        this.match(ExpressParser.T__2);
                        this.state = 125;
                        this.arg();
                        }
                        }
                    }
                    this.state = 130;
                    this.errorHandler.sync(this);
                    alternative = this.interpreter.adaptivePredict(this.tokenStream, 15, this.context);
                }
                this.state = 132;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 3) {
                    {
                    this.state = 131;
                    this.match(ExpressParser.T__2);
                    }
                }

                }
            }

            this.state = 136;
            this.match(ExpressParser.T__8);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public function_name(): Function_nameContext {
        let localContext = new Function_nameContext(this.context, this.state);
        this.enterRule(localContext, 20, ExpressParser.RULE_function_name);
        try {
            this.state = 140;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case ExpressParser.IDENTIFIER:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 138;
                this.identifier();
                }
                break;
            case ExpressParser.SYSTEM_IDENTIFIER:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 139;
                this.match(ExpressParser.SYSTEM_IDENTIFIER);
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public arg(): ArgContext {
        let localContext = new ArgContext(this.context, this.state);
        this.enterRule(localContext, 22, ExpressParser.RULE_arg);
        try {
            this.state = 144;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 19, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 142;
                this.named_arg();
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 143;
                this.expression();
                }
                break;
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public named_arg(): Named_argContext {
        let localContext = new Named_argContext(this.context, this.state);
        this.enterRule(localContext, 24, ExpressParser.RULE_named_arg);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 146;
            this.identifier();
            this.state = 147;
            this.match(ExpressParser.T__0);
            this.state = 148;
            this.expression();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public variable(): VariableContext {
        let localContext = new VariableContext(this.context, this.state);
        this.enterRule(localContext, 26, ExpressParser.RULE_variable);
        try {
            this.state = 152;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case ExpressParser.T__9:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 150;
                this.match(ExpressParser.T__9);
                }
                break;
            case ExpressParser.IDENTIFIER:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 151;
                this.identifier();
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public literal(): LiteralContext {
        let localContext = new LiteralContext(this.context, this.state);
        this.enterRule(localContext, 28, ExpressParser.RULE_literal);
        try {
            this.state = 158;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case ExpressParser.RAW_TRIPLE_STRING:
            case ExpressParser.TRIPLE_STRING:
            case ExpressParser.RAW_STRING:
            case ExpressParser.STANDARD_STRING:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 154;
                this.string_();
                }
                break;
            case ExpressParser.NUMBER:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 155;
                this.match(ExpressParser.NUMBER);
                }
                break;
            case ExpressParser.BOOLEAN:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 156;
                this.match(ExpressParser.BOOLEAN);
                }
                break;
            case ExpressParser.T__10:
                this.enterOuterAlt(localContext, 4);
                {
                this.state = 157;
                this.match(ExpressParser.T__10);
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public identifier(): IdentifierContext {
        let localContext = new IdentifierContext(this.context, this.state);
        this.enterRule(localContext, 30, ExpressParser.RULE_identifier);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 160;
            this.match(ExpressParser.IDENTIFIER);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public string_(): StringContext {
        let localContext = new StringContext(this.context, this.state);
        this.enterRule(localContext, 32, ExpressParser.RULE_string);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 162;
            _la = this.tokenStream.LA(1);
            if(!((((_la) & ~0x1F) === 0 && ((1 << _la) & 61440) !== 0))) {
            this.errorHandler.recoverInline(this);
            }
            else {
                this.errorHandler.reportMatch(this);
                this.consume();
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }

    public static readonly _serializedATN: number[] = [
        4,1,25,165,2,0,7,0,2,1,7,1,2,2,7,2,2,3,7,3,2,4,7,4,2,5,7,5,2,6,7,
        6,2,7,7,7,2,8,7,8,2,9,7,9,2,10,7,10,2,11,7,11,2,12,7,12,2,13,7,13,
        2,14,7,14,2,15,7,15,2,16,7,16,1,0,5,0,36,8,0,10,0,12,0,39,9,0,1,
        0,1,0,1,1,1,1,3,1,45,8,1,1,2,1,2,3,2,49,8,2,1,2,1,2,1,2,1,3,1,3,
        1,3,1,3,1,3,1,3,1,3,3,3,61,8,3,1,4,1,4,1,4,1,4,5,4,67,8,4,10,4,12,
        4,70,9,4,1,4,3,4,73,8,4,3,4,75,8,4,1,4,1,4,1,5,1,5,1,5,1,5,5,5,83,
        8,5,10,5,12,5,86,9,5,1,5,3,5,89,8,5,3,5,91,8,5,1,5,1,5,1,6,1,6,3,
        6,97,8,6,1,6,1,6,1,6,1,7,1,7,1,8,1,8,1,8,1,8,1,8,5,8,109,8,8,10,
        8,12,8,112,9,8,1,8,3,8,115,8,8,3,8,117,8,8,1,8,3,8,120,8,8,1,9,1,
        9,1,9,1,9,1,9,5,9,127,8,9,10,9,12,9,130,9,9,1,9,3,9,133,8,9,3,9,
        135,8,9,1,9,1,9,1,10,1,10,3,10,141,8,10,1,11,1,11,3,11,145,8,11,
        1,12,1,12,1,12,1,12,1,13,1,13,3,13,153,8,13,1,14,1,14,1,14,1,14,
        3,14,159,8,14,1,15,1,15,1,16,1,16,1,16,0,0,17,0,2,4,6,8,10,12,14,
        16,18,20,22,24,26,28,30,32,0,1,1,0,12,15,176,0,37,1,0,0,0,2,44,1,
        0,0,0,4,48,1,0,0,0,6,60,1,0,0,0,8,62,1,0,0,0,10,78,1,0,0,0,12,96,
        1,0,0,0,14,101,1,0,0,0,16,103,1,0,0,0,18,121,1,0,0,0,20,140,1,0,
        0,0,22,144,1,0,0,0,24,146,1,0,0,0,26,152,1,0,0,0,28,158,1,0,0,0,
        30,160,1,0,0,0,32,162,1,0,0,0,34,36,3,2,1,0,35,34,1,0,0,0,36,39,
        1,0,0,0,37,35,1,0,0,0,37,38,1,0,0,0,38,40,1,0,0,0,39,37,1,0,0,0,
        40,41,5,0,0,1,41,1,1,0,0,0,42,45,3,4,2,0,43,45,3,6,3,0,44,42,1,0,
        0,0,44,43,1,0,0,0,45,3,1,0,0,0,46,49,3,30,15,0,47,49,3,14,7,0,48,
        46,1,0,0,0,48,47,1,0,0,0,49,50,1,0,0,0,50,51,5,1,0,0,51,52,3,6,3,
        0,52,5,1,0,0,0,53,61,3,8,4,0,54,61,3,10,5,0,55,61,3,14,7,0,56,61,
        3,16,8,0,57,61,3,18,9,0,58,61,3,26,13,0,59,61,3,28,14,0,60,53,1,
        0,0,0,60,54,1,0,0,0,60,55,1,0,0,0,60,56,1,0,0,0,60,57,1,0,0,0,60,
        58,1,0,0,0,60,59,1,0,0,0,61,7,1,0,0,0,62,74,5,2,0,0,63,68,3,6,3,
        0,64,65,5,3,0,0,65,67,3,6,3,0,66,64,1,0,0,0,67,70,1,0,0,0,68,66,
        1,0,0,0,68,69,1,0,0,0,69,72,1,0,0,0,70,68,1,0,0,0,71,73,5,3,0,0,
        72,71,1,0,0,0,72,73,1,0,0,0,73,75,1,0,0,0,74,63,1,0,0,0,74,75,1,
        0,0,0,75,76,1,0,0,0,76,77,5,4,0,0,77,9,1,0,0,0,78,90,5,5,0,0,79,
        84,3,12,6,0,80,81,5,3,0,0,81,83,3,12,6,0,82,80,1,0,0,0,83,86,1,0,
        0,0,84,82,1,0,0,0,84,85,1,0,0,0,85,88,1,0,0,0,86,84,1,0,0,0,87,89,
        5,3,0,0,88,87,1,0,0,0,88,89,1,0,0,0,89,91,1,0,0,0,90,79,1,0,0,0,
        90,91,1,0,0,0,91,92,1,0,0,0,92,93,5,6,0,0,93,11,1,0,0,0,94,97,3,
        30,15,0,95,97,3,32,16,0,96,94,1,0,0,0,96,95,1,0,0,0,97,98,1,0,0,
        0,98,99,5,7,0,0,99,100,3,6,3,0,100,13,1,0,0,0,101,102,5,16,0,0,102,
        15,1,0,0,0,103,119,5,17,0,0,104,116,5,8,0,0,105,110,3,6,3,0,106,
        107,5,3,0,0,107,109,3,6,3,0,108,106,1,0,0,0,109,112,1,0,0,0,110,
        108,1,0,0,0,110,111,1,0,0,0,111,114,1,0,0,0,112,110,1,0,0,0,113,
        115,5,3,0,0,114,113,1,0,0,0,114,115,1,0,0,0,115,117,1,0,0,0,116,
        105,1,0,0,0,116,117,1,0,0,0,117,118,1,0,0,0,118,120,5,9,0,0,119,
        104,1,0,0,0,119,120,1,0,0,0,120,17,1,0,0,0,121,122,3,20,10,0,122,
        134,5,8,0,0,123,128,3,22,11,0,124,125,5,3,0,0,125,127,3,22,11,0,
        126,124,1,0,0,0,127,130,1,0,0,0,128,126,1,0,0,0,128,129,1,0,0,0,
        129,132,1,0,0,0,130,128,1,0,0,0,131,133,5,3,0,0,132,131,1,0,0,0,
        132,133,1,0,0,0,133,135,1,0,0,0,134,123,1,0,0,0,134,135,1,0,0,0,
        135,136,1,0,0,0,136,137,5,9,0,0,137,19,1,0,0,0,138,141,3,30,15,0,
        139,141,5,21,0,0,140,138,1,0,0,0,140,139,1,0,0,0,141,21,1,0,0,0,
        142,145,3,24,12,0,143,145,3,6,3,0,144,142,1,0,0,0,144,143,1,0,0,
        0,145,23,1,0,0,0,146,147,3,30,15,0,147,148,5,1,0,0,148,149,3,6,3,
        0,149,25,1,0,0,0,150,153,5,10,0,0,151,153,3,30,15,0,152,150,1,0,
        0,0,152,151,1,0,0,0,153,27,1,0,0,0,154,159,3,32,16,0,155,159,5,18,
        0,0,156,159,5,19,0,0,157,159,5,11,0,0,158,154,1,0,0,0,158,155,1,
        0,0,0,158,156,1,0,0,0,158,157,1,0,0,0,159,29,1,0,0,0,160,161,5,20,
        0,0,161,31,1,0,0,0,162,163,7,0,0,0,163,33,1,0,0,0,22,37,44,48,60,
        68,72,74,84,88,90,96,110,114,116,119,128,132,134,140,144,152,158
    ];

    private static __ATN: antlr.ATN;
    public static get _ATN(): antlr.ATN {
        if (!ExpressParser.__ATN) {
            ExpressParser.__ATN = new antlr.ATNDeserializer().deserialize(ExpressParser._serializedATN);
        }

        return ExpressParser.__ATN;
    }


    private static readonly vocabulary = new antlr.Vocabulary(ExpressParser.literalNames, ExpressParser.symbolicNames, []);

    public override get vocabulary(): antlr.Vocabulary {
        return ExpressParser.vocabulary;
    }

    private static readonly decisionsToDFA = ExpressParser._ATN.decisionToState.map( (ds: antlr.DecisionState, index: number) => new antlr.DFA(ds, index) );
}

export class ProgramContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public EOF(): antlr.TerminalNode {
        return this.getToken(ExpressParser.EOF, 0)!;
    }
    public statement(): StatementContext[];
    public statement(i: number): StatementContext | null;
    public statement(i?: number): StatementContext[] | StatementContext | null {
        if (i === undefined) {
            return this.getRuleContexts(StatementContext);
        }

        return this.getRuleContext(i, StatementContext);
    }
    public override get ruleIndex(): number {
        return ExpressParser.RULE_program;
    }
    public override accept<Result>(visitor: ExpressVisitor<Result>): Result | null {
        if (visitor.visitProgram) {
            return visitor.visitProgram(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class StatementContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public assignment(): AssignmentContext | null {
        return this.getRuleContext(0, AssignmentContext);
    }
    public expression(): ExpressionContext | null {
        return this.getRuleContext(0, ExpressionContext);
    }
    public override get ruleIndex(): number {
        return ExpressParser.RULE_statement;
    }
    public override accept<Result>(visitor: ExpressVisitor<Result>): Result | null {
        if (visitor.visitStatement) {
            return visitor.visitStatement(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class AssignmentContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public expression(): ExpressionContext {
        return this.getRuleContext(0, ExpressionContext)!;
    }
    public identifier(): IdentifierContext | null {
        return this.getRuleContext(0, IdentifierContext);
    }
    public path(): PathContext | null {
        return this.getRuleContext(0, PathContext);
    }
    public override get ruleIndex(): number {
        return ExpressParser.RULE_assignment;
    }
    public override accept<Result>(visitor: ExpressVisitor<Result>): Result | null {
        if (visitor.visitAssignment) {
            return visitor.visitAssignment(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class ExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public array(): ArrayContext | null {
        return this.getRuleContext(0, ArrayContext);
    }
    public map(): MapContext | null {
        return this.getRuleContext(0, MapContext);
    }
    public path(): PathContext | null {
        return this.getRuleContext(0, PathContext);
    }
    public check(): CheckContext | null {
        return this.getRuleContext(0, CheckContext);
    }
    public call(): CallContext | null {
        return this.getRuleContext(0, CallContext);
    }
    public variable(): VariableContext | null {
        return this.getRuleContext(0, VariableContext);
    }
    public literal(): LiteralContext | null {
        return this.getRuleContext(0, LiteralContext);
    }
    public override get ruleIndex(): number {
        return ExpressParser.RULE_expression;
    }
    public override accept<Result>(visitor: ExpressVisitor<Result>): Result | null {
        if (visitor.visitExpression) {
            return visitor.visitExpression(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class ArrayContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public expression(): ExpressionContext[];
    public expression(i: number): ExpressionContext | null;
    public expression(i?: number): ExpressionContext[] | ExpressionContext | null {
        if (i === undefined) {
            return this.getRuleContexts(ExpressionContext);
        }

        return this.getRuleContext(i, ExpressionContext);
    }
    public override get ruleIndex(): number {
        return ExpressParser.RULE_array;
    }
    public override accept<Result>(visitor: ExpressVisitor<Result>): Result | null {
        if (visitor.visitArray) {
            return visitor.visitArray(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class MapContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public map_entry(): Map_entryContext[];
    public map_entry(i: number): Map_entryContext | null;
    public map_entry(i?: number): Map_entryContext[] | Map_entryContext | null {
        if (i === undefined) {
            return this.getRuleContexts(Map_entryContext);
        }

        return this.getRuleContext(i, Map_entryContext);
    }
    public override get ruleIndex(): number {
        return ExpressParser.RULE_map;
    }
    public override accept<Result>(visitor: ExpressVisitor<Result>): Result | null {
        if (visitor.visitMap) {
            return visitor.visitMap(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class Map_entryContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public expression(): ExpressionContext {
        return this.getRuleContext(0, ExpressionContext)!;
    }
    public identifier(): IdentifierContext | null {
        return this.getRuleContext(0, IdentifierContext);
    }
    public string(): StringContext | null {
        return this.getRuleContext(0, StringContext);
    }
    public override get ruleIndex(): number {
        return ExpressParser.RULE_map_entry;
    }
    public override accept<Result>(visitor: ExpressVisitor<Result>): Result | null {
        if (visitor.visitMap_entry) {
            return visitor.visitMap_entry(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class PathContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public PATH(): antlr.TerminalNode {
        return this.getToken(ExpressParser.PATH, 0)!;
    }
    public override get ruleIndex(): number {
        return ExpressParser.RULE_path;
    }
    public override accept<Result>(visitor: ExpressVisitor<Result>): Result | null {
        if (visitor.visitPath) {
            return visitor.visitPath(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class CheckContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public CHECK(): antlr.TerminalNode {
        return this.getToken(ExpressParser.CHECK, 0)!;
    }
    public expression(): ExpressionContext[];
    public expression(i: number): ExpressionContext | null;
    public expression(i?: number): ExpressionContext[] | ExpressionContext | null {
        if (i === undefined) {
            return this.getRuleContexts(ExpressionContext);
        }

        return this.getRuleContext(i, ExpressionContext);
    }
    public override get ruleIndex(): number {
        return ExpressParser.RULE_check;
    }
    public override accept<Result>(visitor: ExpressVisitor<Result>): Result | null {
        if (visitor.visitCheck) {
            return visitor.visitCheck(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class CallContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public function_name(): Function_nameContext {
        return this.getRuleContext(0, Function_nameContext)!;
    }
    public arg(): ArgContext[];
    public arg(i: number): ArgContext | null;
    public arg(i?: number): ArgContext[] | ArgContext | null {
        if (i === undefined) {
            return this.getRuleContexts(ArgContext);
        }

        return this.getRuleContext(i, ArgContext);
    }
    public override get ruleIndex(): number {
        return ExpressParser.RULE_call;
    }
    public override accept<Result>(visitor: ExpressVisitor<Result>): Result | null {
        if (visitor.visitCall) {
            return visitor.visitCall(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class Function_nameContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public identifier(): IdentifierContext | null {
        return this.getRuleContext(0, IdentifierContext);
    }
    public SYSTEM_IDENTIFIER(): antlr.TerminalNode | null {
        return this.getToken(ExpressParser.SYSTEM_IDENTIFIER, 0);
    }
    public override get ruleIndex(): number {
        return ExpressParser.RULE_function_name;
    }
    public override accept<Result>(visitor: ExpressVisitor<Result>): Result | null {
        if (visitor.visitFunction_name) {
            return visitor.visitFunction_name(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class ArgContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public named_arg(): Named_argContext | null {
        return this.getRuleContext(0, Named_argContext);
    }
    public expression(): ExpressionContext | null {
        return this.getRuleContext(0, ExpressionContext);
    }
    public override get ruleIndex(): number {
        return ExpressParser.RULE_arg;
    }
    public override accept<Result>(visitor: ExpressVisitor<Result>): Result | null {
        if (visitor.visitArg) {
            return visitor.visitArg(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class Named_argContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public identifier(): IdentifierContext {
        return this.getRuleContext(0, IdentifierContext)!;
    }
    public expression(): ExpressionContext {
        return this.getRuleContext(0, ExpressionContext)!;
    }
    public override get ruleIndex(): number {
        return ExpressParser.RULE_named_arg;
    }
    public override accept<Result>(visitor: ExpressVisitor<Result>): Result | null {
        if (visitor.visitNamed_arg) {
            return visitor.visitNamed_arg(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class VariableContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public identifier(): IdentifierContext | null {
        return this.getRuleContext(0, IdentifierContext);
    }
    public override get ruleIndex(): number {
        return ExpressParser.RULE_variable;
    }
    public override accept<Result>(visitor: ExpressVisitor<Result>): Result | null {
        if (visitor.visitVariable) {
            return visitor.visitVariable(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class LiteralContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public string(): StringContext | null {
        return this.getRuleContext(0, StringContext);
    }
    public NUMBER(): antlr.TerminalNode | null {
        return this.getToken(ExpressParser.NUMBER, 0);
    }
    public BOOLEAN(): antlr.TerminalNode | null {
        return this.getToken(ExpressParser.BOOLEAN, 0);
    }
    public override get ruleIndex(): number {
        return ExpressParser.RULE_literal;
    }
    public override accept<Result>(visitor: ExpressVisitor<Result>): Result | null {
        if (visitor.visitLiteral) {
            return visitor.visitLiteral(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class IdentifierContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public IDENTIFIER(): antlr.TerminalNode {
        return this.getToken(ExpressParser.IDENTIFIER, 0)!;
    }
    public override get ruleIndex(): number {
        return ExpressParser.RULE_identifier;
    }
    public override accept<Result>(visitor: ExpressVisitor<Result>): Result | null {
        if (visitor.visitIdentifier) {
            return visitor.visitIdentifier(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class StringContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public RAW_TRIPLE_STRING(): antlr.TerminalNode | null {
        return this.getToken(ExpressParser.RAW_TRIPLE_STRING, 0);
    }
    public TRIPLE_STRING(): antlr.TerminalNode | null {
        return this.getToken(ExpressParser.TRIPLE_STRING, 0);
    }
    public RAW_STRING(): antlr.TerminalNode | null {
        return this.getToken(ExpressParser.RAW_STRING, 0);
    }
    public STANDARD_STRING(): antlr.TerminalNode | null {
        return this.getToken(ExpressParser.STANDARD_STRING, 0);
    }
    public override get ruleIndex(): number {
        return ExpressParser.RULE_string;
    }
    public override accept<Result>(visitor: ExpressVisitor<Result>): Result | null {
        if (visitor.visitString) {
            return visitor.visitString(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}
