# Dataset preparation

Tools for downloading the UCF-Crime subset and building UCF and MERL Shopping indexes. Shared data lives under `/srv/kryptonx-data/`; these scripts do not require copying datasets into the repository.

## Tools

| Script | Purpose |
| --- | --- |
| [data_prep/download_ucf_subset.py](data_prep/download_ucf_subset.py) | Download selected UCF archive members with integrity checks |
| [data_prep/build_ucf_index.py](data_prep/build_ucf_index.py) | Build video and temporal-event indexes |
| [data_prep/build_merl_index.py](data_prep/build_merl_index.py) | Build MERL video and action indexes |
| [data_prep/tests](data_prep/tests) | Offline regression tests for the download and indexing logic |

Inspect each script's options before running a download or changing a shared index:

```bash
python3 model/sonakshi/data_prep/download_ucf_subset.py --help
python3 model/sonakshi/data_prep/build_ucf_index.py --help
python3 model/sonakshi/data_prep/build_merl_index.py --help
```

MERL indexing needs the scientific Python dependencies used by its label reader. Preserve the shared directory's group ownership and permissions when extracting archives.

## Verify

From the repository root:

```bash
python3 -m unittest discover -s model/sonakshi/data_prep/tests
```

Report dependency-related skips separately from passing tests. For split rules, time conversion, and annotation provenance, see the [study data guide](../study/README.md).
