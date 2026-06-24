# Copyright 2026 Google LLC
import os
import json
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Load variables from .env
load_dotenv()

# Initialize client.
client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

MODEL_NAME = os.getenv("GENAI_MODEL", "gemini-2.5-flash")

# Fallback controls used if the LLM fails to provide valid JSON components
DEFAULT_CONTROLS = [
    {"type": "slider", "label": "Verbose vs. Concise"},
    {"type": "slider", "label": "Standard vs. Punchy"}
]

def generate_controls(text: str, full_text: str = None) -> list:
    """
    Generates the A2UI layout JSON for the editor sidebar based on text.
    We utilize Gemini to generate optimized, expansive tuning controls relevant to the text.
    Supports sliders, checkboxes, and selection dropdowns.
    """
    controls_schema = {
        "type": "object",
        "properties": {
            "initial_thought": {
                "type": "string",
                "description": "An insightful, evocative paragraph (1-2 short sentences) offering creative direction, critique, or themes to inspire the writer."
            },
            "controls": {
                "type": "array",
                "description": "A list of 2 to 3 dynamic UI components best suited for tuning the selected text.",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["slider", "select", "checkbox"],
                            "description": "The widget type."
                        },
                        "label": {
                            "type": "string",
                            "description": "Human readable label. For sliders MUST ALWAYS follow 'X vs. Y' pattern."
                        },
                        "options": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Required only when type='select'. The list of string choices to populate dropdown."
                        }
                    },
                    "required": ["type", "label"]
                }
            }
        },
        "required": ["initial_thought", "controls"]
    }

    prompt = f"""
    You are an AI inspiration partner and professional editor. Instead of just proposing simple edits, act as a catalyst for creativity—providing evocative feedback and soliciting directions.
    Based on the highlighted text, design a highly relevant set of 2 to 3 dynamic, expansive user interface controls to help the user explore ambitious revisions or refinement pathways.
    Select ONLY the control types that specifically make sense for this segment; do NOT feel obligated to include one of each.
    
    Highlighted Text: "{text}"
    
    Available Control Types:
    - "slider": Best for continuous degree changes. You MUST format the label as "X vs. Y" to denote the two polar ends of the scale (e.g., "Academic vs. Casual", "Detailed vs. Concise").
    - "checkbox": Best for enabling/disabling explicit thematic enhancements (e.g., "Inject subtle humor", "Structure as bulleted steps", "Include call to action").
    - "select": Best for choosing from mutually exclusive distinct thematic directions, voice presets, or stylistic templates. Requires an `options` list of short descriptive options (e.g., Atmosphere: ["Ominous", "Optimistic", "Scholarly"]).
    """

    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=controls_schema,
            )
        )
        config_json = json.loads(response.text)
        controls = config_json.get("controls", [])
        
        if not isinstance(controls, list) or not controls:
            controls = DEFAULT_CONTROLS
        controls = controls[:3] # cap at 3 controls
        summary = config_json.get("initial_thought", "What direction would you like to explore with this segment?")
    except Exception as e:
        print(f"Error calling Gemini for controls: {e}")
        controls = DEFAULT_CONTROLS
        summary = "Ready to explore variations. Adjust the dials below to tune the output."

    # Setup data model initial state
    data_model_contents = [
        {"key": "summary_text", "valueString": summary},
        {"key": "original_text", "valueString": text},
        {"key": "full_text", "valueString": full_text or text},
    ]
    
    # Setup component manifest starting with statics
    components = [
        {"id": "root", "component": {"Card": {"child": "col"}}},
        {"id": "title", "component": {"Text": {"text": {"literalString": "Inspiration Agent"}, "usageHint": "h3"}}},
        {"id": "summary", "component": {"Text": {"text": {"path": "/summary_text"}, "usageHint": "body"}}},
        {"id": "divider_summary", "component": {"Divider": {"axis": "horizontal"}}},
    ]
    
    # Column explicit child order
    column_children = ["title", "summary", "divider_summary"]
    
    # Inject generated controls
    for i, ctrl in enumerate(controls):
        ctype = ctrl.get("type", "slider").lower()
        label = ctrl.get("label", "Control")
        key = f"control_{i}"
        
        # Setup default values & UI definition based on type
        spacer_id = f"spacer_{i}"
        column_children.append(spacer_id)
        components.append({"id": spacer_id, "component": {"Text": {"text": {"literalString": " "}}}})
        
        if ctype == "checkbox":
            data_model_contents.append({"key": key, "valueBoolean": False})
            ctrl_id = f"checkbox_{i}"
            column_children.append(ctrl_id)
            components.append({
                "id": ctrl_id,
                "component": {
                    "CheckBox": {
                        "label": {"literalString": label},
                        "value": {"path": f"/{key}"}
                    }
                }
            })
        elif ctype == "select":
            opt_raw = ctrl.get("options", [])
            if not isinstance(opt_raw, list) or not opt_raw:
                opt_raw = ["Option A", "Option B"]
            opt_raw = [str(o) for o in opt_raw]
            
            # Initialize model with a JSON-stringified object containing the first option wrapped in literalArray.
            # This matches the format utilized by the MultipleChoice component logic in the renderer.
            init_val = json.dumps({"literalArray": [opt_raw[0]]})
            data_model_contents.append({"key": key, "valueString": init_val})
            
            formatted_options = [{"label": {"literalString": o}, "value": o} for o in opt_raw]
            lbl_id = f"lbl_{i}"
            ctrl_id = f"select_{i}"
            column_children.append(lbl_id)
            column_children.append(ctrl_id)
            
            components.append({"id": lbl_id, "component": {"Text": {"text": {"literalString": label}, "usageHint": "body"}}})
            components.append({
                "id": ctrl_id,
                "component": {
                    "MultipleChoice": {
                        "options": formatted_options,
                        "selections": {"path": f"/{key}"}
                    }
                }
            })
        else:
            # Slider
            data_model_contents.append({"key": key, "valueNumber": 50})
            lbl_id = f"lbl_{i}"
            sld_id = f"slider_{i}"
            column_children.append(lbl_id)
            column_children.append(sld_id)
            components.append({"id": lbl_id, "component": {"Text": {"text": {"literalString": label}, "usageHint": "body"}}})
            components.append({"id": sld_id, "component": {"Slider": {"value": {"path": f"/{key}"}, "minValue": 0, "maxValue": 100}}})

    # Add end space and apply button
    column_children.append("spacer_end")
    components.append({"id": "spacer_end", "component": {"Text": {"text": {"literalString": " "}}}})
    
    column_children.append("apply_btn")
    components.append({"id": "apply_btn_txt", "component": {"Text": {"text": {"literalString": "Generate Revision"}}}})
    components.append({
        "id": "apply_btn",
        "component": {
            "Button": {
                "child": "apply_btn_txt",
                "action": {
                    "name": "smart_editor_apply",
                    "context": [
                        {"key": "control_config_json", "value": {"literalString": json.dumps(controls)}}
                    ]
                }
            }
        }
    })
    
    # Finally add the Column housing them all
    components.append({
        "id": "col",
        "component": {
            "Column": {
                "children": {"explicitList": column_children}
            }
        }
    })

    # Construct final A2UI payload
    surface_id = "editor-controls"
    a2ui_messages = [
        {
            "dataModelUpdate": {
                "surfaceId": surface_id,
                "contents": data_model_contents
            }
        },
        {
            "surfaceUpdate": {
                "surfaceId": surface_id,
                "components": components
            }
        },
        {
            "beginRendering": {
                "surfaceId": surface_id,
                "root": "root"
            }
        }
    ]
    return a2ui_messages

def apply_revision(text: str, user_parameters: dict) -> str:
    """
    Takes flexible control parameters and original text and calls Gemini to rewrite the content.
    Now includes support for parsing selection arrays.
    """
    # Extract dynamic configurations
    config_raw = user_parameters.get("control_config_json", "[]")
    try:
        controls = json.loads(config_raw)
    except Exception:
        controls = []
        
    # Construct prompt blocks from active settings
    control_prompt_lines = []
    for i, ctrl in enumerate(controls):
        ctype = ctrl.get("type", "slider").lower()
        label = ctrl.get("label", "Setting")
        key = f"control_{i}"
        val = user_parameters.get(key)
        
        if ctype == "checkbox":
            status = "Enabled" if val else "Disabled"
            control_prompt_lines.append(f"- {label}: {status}")
        elif ctype == "select":
            # Robustly handle selection recovery. The data model maps object values.
            selected_val = ""
            if isinstance(val, dict):
                # Check standard A2UI data object
                s = val.get("literalArray", [])
                if isinstance(s, list) and len(s) > 0:
                    selected_val = str(s[0])
            elif isinstance(val, list) and len(val) > 0:
                selected_val = str(val[0])
            elif val:
                selected_val = str(val)
            
            if not selected_val:
                # Attempt to extract default from original control definition
                defs = ctrl.get("options", [])
                selected_val = defs[0] if defs else "Unknown"
            control_prompt_lines.append(f"- {label}: {selected_val}")
        else:
            try:
                num_val = float(val if val is not None else 50) / 100.0
            except (ValueError, TypeError):
                num_val = 0.5
            control_prompt_lines.append(f"- {label}: {num_val:.2f} (0 meaning low/minimum expression, 1 meaning high/maximum)")
            
    adjustment_context = "\n    ".join(control_prompt_lines)
    if not adjustment_context:
        adjustment_context = "No specific adjustments chosen."

    full_text = user_parameters.get("full_text", text)

    revision_schema = {
        "type": "object",
        "properties": {
            "text_before": {"type": "string"},
            "original_text": {"type": "string"},
            "revised_text": {"type": "string"},
            "text_after": {"type": "string"}
        },
        "required": ["text_before", "original_text", "revised_text", "text_after"]
    }

    prompt = f"""
    You are a collaborative professional writing assistant.
    Analyze the following user input along with their preferred stylistic tuning specifications.
    The user has highlighted a segment within a full text block.
    You should revise the highlighted segment according to the specifications.
    
    Identify the text before the highlighted segment, the original highlighted segment itself, the revised version of that segment, and the text after the highlighted segment.
    
    Full Text Block: "{full_text}"
    Highlighted Segment: "{text}"
    
    User Tuned Specifications:
    {adjustment_context}
    """

    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=revision_schema,
            )
        )
        return response.text.strip()
    except Exception as e:
        print(f"Error calling Gemini for rewrite: {e}")
        return f"[Error occurred during rewrite: {e}]"


