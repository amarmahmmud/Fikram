import modal

app = modal.App("gemma-diagnostic")

image = (
    modal.Image.from_registry("nvidia/cuda:12.1.1-devel-ubuntu22.04", add_python="3.11")
    .pip_install(
        "torch==2.4.0",
        extra_index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install(
        "transformers==5.5.0",
        "accelerate"
    )
)

@app.function(image=image, gpu="L4")
def run_diagnostic():
    import torch
    import os
    from transformers import AutoModelForCausalLM, AutoTokenizer

    base_model = "unsloth/gemma-2-2b-it"
    hf_token = os.environ.get("HF_TOKEN")

    print(f"Loading {base_model} with Transformers 5.5.0...")
    tok = AutoTokenizer.from_pretrained(base_model, token=hf_token)
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        torch_dtype=torch.bfloat16,
        attn_implementation="eager",
        token=hf_token,
    ).to("cuda")

    test_text = "<bos><start_of_turn>user If a user feels overwhelmed by a major setback and doesn't know where to start rebuilding their life, what practical steps should they take based on this text?<end_of_turn> <start_of_turn>model They should start small by focusing on basic daily routines within their immediat"
    
    test_ids = tok(test_text, return_tensors="pt", add_special_tokens=False).input_ids.to("cuda")
    
    with torch.no_grad():
        out = model(input_ids=test_ids, labels=test_ids)
    
    print("Plain HF loss (Transformers 5.5.0):", out.loss.item())

@app.local_entrypoint()
def main():
    run_diagnostic.remote()
