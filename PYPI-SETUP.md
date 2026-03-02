# Publishing clapcheeks to PyPI

## 1. Create a PyPI account

1. Go to https://pypi.org/account/register/
2. Create an account and verify your email
3. Enable 2FA (required by PyPI)

## 2. Create an API token

1. Go to https://pypi.org/manage/account/token/
2. Click "Add API token"
3. Token name: `clapcheeks-publish`
4. Scope: "Entire account" for the first upload, then scope to the `clapcheeks` project afterward
5. Copy the token (starts with `pypi-`)

## 3. Upload manually

From the `agent/` directory (dist files already built):

```bash
cd /opt/agency-workspace/clapcheeks.tech/agent

# Build (if not already done)
python3 -m build

# Upload
TWINE_PASSWORD=pypi-YOUR_TOKEN_HERE python3 -m twine upload dist/* --username __token__ --non-interactive
```

## 4. Verify it works

```bash
pip install clapcheeks
clapcheeks --help
```

## 5. Add token to GitHub for automated releases

1. Go to the repo Settings > Secrets and variables > Actions
2. Click "New repository secret"
3. Name: `PYPI_API_TOKEN`
4. Value: paste the `pypi-...` token
5. Click "Add secret"

Once the secret is set, pushing a tag like `v0.1.0` will trigger the automated publish workflow at `.github/workflows/publish-pypi.yml`.

## 6. Publish a release

```bash
git tag v0.1.0
git push origin v0.1.0
```

The GitHub Action will build, publish to PyPI, and verify the install automatically.
