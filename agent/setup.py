from setuptools import setup, find_packages
setup(
    name="outward",
    version="0.1.0",
    packages=find_packages(),
    entry_points={"console_scripts": ["outward = outward.cli:main"]},
    install_requires=open("requirements.txt").read().splitlines(),
    python_requires=">=3.11",
)
