# GLM-4.5V inference + QLoRA training image for the GB10 (aarch64, sm_121, CUDA 13).
# Base provides torch (CUDA 13.2), transformers >= 4.57.1 and vLLM; we add the fine-tuning stack.
# Build: docker build -t kryptonx/glm:dev model/env/glm
FROM nvcr.io/nvidia/vllm:26.03.post1-py3@sha256:fe21f1b1f3a53886515a191ba6309065a54b3e026fe8a43573e75e4ecdfd530d

# Keep the base image's torch/transformers; only add what is missing.
RUN pip install --no-cache-dir \
        peft \
        accelerate \
        bitsandbytes \
        av \
        scikit-learn \
    && pip freeze > /opt/requirements.lock

WORKDIR /workspace
