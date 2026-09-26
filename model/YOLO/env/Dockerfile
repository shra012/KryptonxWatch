# YOLO person detector for grounding VLM boxes (plan: model/README.md, Phase 3).
# Builds on the GB10 CUDA/PyTorch image; --no-deps keeps its NVIDIA torch build instead of a pip torch.
# Build: docker build -t kryptonx/yolo:dev model/YOLO/env
FROM kryptonx/glm:dev
RUN pip install --no-cache-dir --no-deps ultralytics ultralytics-thop \
    && pip install --no-cache-dir "opencv-python-headless>=4.8" "py-cpuinfo" "polars" "seaborn" "matplotlib" \
    && python -c "import ultralytics, torch; print(ultralytics.__version__, torch.__version__)" \
    && pip freeze > /opt/requirements-yolo.lock
