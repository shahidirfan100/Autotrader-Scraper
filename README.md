# Autotrader Canada Scraper

Extract vehicle listings with home delivery options from Autotrader.ca, Canada's largest online automotive marketplace. Collect comprehensive car data including pricing, specifications, seller information, and high-resolution images.

## Features

- **Home Delivery Listings** — Focus on vehicles available for contactless purchase and home delivery across Canada
- **Advanced Filtering** — Search by make, model, year range, price range, mileage, and location
- **Complete Vehicle Data** — Extract 25+ data points per listing including VIN, stock number, and full specifications
- **Location Targeting** — Filter by Canadian province and city for localized results
- **High-Resolution Images** — Capture all gallery images for each vehicle listing
- **Seller Information** — Identify dealerships vs private sellers with complete contact details

## Use Cases

- **Market Research** — Analyze vehicle pricing trends across Canadian provinces
- **Inventory Monitoring** — Track competitor dealer inventory and pricing strategies
- **Data Analytics** — Build datasets for automotive market analysis and machine learning
- **Price Comparison** — Compare vehicle values across different regions and sellers
- **Lead Generation** — Identify vehicles matching specific buyer criteria

## Input Configuration

| Parameter | Type | Description |
|-----------|------|-------------|
| `make` | String | Vehicle manufacturer (e.g., Honda, Toyota, Ford) |
| `model` | String | Vehicle model (e.g., Civic, Camry, F-150) |
| `province` | String | Canadian province code (on, bc, ab, qc, etc.) |
| `city` | String | City name for localized search |
| `minYear` / `maxYear` | Integer | Model year range filter |
| `minPrice` / `maxPrice` | Integer | Price range in CAD |
| `minMileage` / `maxMileage` | Integer | Odometer range in kilometers |
| `results_wanted` | Integer | Maximum listings to collect (default: 50) |
| `max_pages` | Integer | Maximum pages to process (default: 20) |
| `startUrl` | String | Direct search URL (overrides other filters) |

## Output Data

Each vehicle listing includes:

```json
{
  "ad_id": "12345678",
  "make": "Honda",
  "model": "Civic",
  "year": 2022,
  "trim": "EX",
  "price": 28995,
  "price_formatted": "$28,995",
  "mileage": 45230,
  "mileage_formatted": "45,230 km",
  "transmission": "Automatic",
  "drivetrain": "FWD",
  "body_type": "Sedan",
  "exterior_color": "Crystal Black Pearl",
  "interior_color": "Black",
  "fuel_type": "Gasoline",
  "engine": "2.0L 4-Cylinder",
  "doors": 4,
  "seats": 5,
  "city": "Toronto",
  "province": "ON",
  "seller_name": "AutoMax Dealership",
  "is_private_seller": false,
  "dealer_id": "D12345",
  "description": "Well-maintained one-owner vehicle...",
  "images": [
    "https://images.autotrader.ca/.../image1.jpg",
    "https://images.autotrader.ca/.../image2.jpg"
  ],
  "vehicle_status": "Used",
  "vin": "2HGFC2F59NH123456",
  "stock_number": "A12345",
  "features": ["Sunroof", "Heated Seats", "Apple CarPlay"],
  "url": "https://www.autotrader.ca/a/honda/civic/..."
}
```

## Example Configurations

### Search for Honda Civic in Ontario

```json
{
  "make": "honda",
  "model": "civic",
  "province": "on",
  "results_wanted": 50
}
```

### Find Vehicles Under $30,000

```json
{
  "maxPrice": 30000,
  "minYear": 2020,
  "results_wanted": 100
}
```

### Search Cars in Alberta

```json
{
  "province": "ab",
  "city": "calgary",
  "results_wanted": 75
}
```

## Tips for Best Results

1. **Use Residential Proxies** — For reliable data extraction, residential proxies are recommended
2. **Start Small** — Test with `results_wanted: 20` before running larger extractions
3. **Combine Filters** — Use multiple filters to narrow down to relevant listings
4. **Province Codes** — Use lowercase province codes: on (Ontario), bc (British Columbia), ab (Alberta), qc (Quebec), etc.

## Integrations

Export your scraped vehicle data to:

- **Google Sheets** — Automatic spreadsheet updates
- **Slack** — Notifications for new listings
- **Webhook** — Send data to your custom endpoints
- **Email** — Scheduled reports delivered to your inbox

## Frequently Asked Questions

**How many listings can I scrape?**
There is no hard limit. Adjust `results_wanted` and `max_pages` based on your needs.

**How often is the data updated?**
Schedule runs hourly, daily, or weekly using Apify's scheduling feature to get fresh listings.

**What provinces are supported?**
All Canadian provinces and territories: ON, BC, AB, QC, MB, SK, NS, NB, NL, PE, NT, YT, NU.

## Support

For questions or issues, please open an issue on the actor's GitHub repository or contact support through Apify.