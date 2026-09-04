# PFG Load Map Generator

Phone-first application for converting photographed Performance Food Group pallet plans into printable two-page trailer load maps.

## Production hosting

The application is hosted on Vercel so photographed sheets can be analyzed through a protected OpenAI API endpoint. The source remains in GitHub and each push to `main` automatically deploys the latest version.

Required protected Vercel environment variables:

- `OPENAI_API_KEY`
- `APP_ACCESS_CODE`

The API key remains server-side. Photos are analyzed for the current request and are not stored by this application. Print output is generated locally on the user's device.
