// Autotrader.ca Home Delivery Scraper - CheerioCrawler implementation
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';

await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            make = '',
            model = '',
            province = '',
            city = '',
            minYear,
            maxYear,
            minPrice,
            maxPrice,
            minMileage,
            maxMileage,
            results_wanted: RESULTS_WANTED_RAW = 50,
            max_pages: MAX_PAGES_RAW = 20,
            startUrl,
            startUrls,
            url,
            proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : 50;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 20;
        const PAGE_SIZE = 15;

        const toAbs = (href, base = 'https://www.autotrader.ca') => {
            try { return new URL(href, base).href; } catch { return null; }
        };

        const cleanText = (text) => {
            if (!text) return null;
            const cleaned = String(text).replace(/\s+/g, ' ').trim();
            return cleaned || null;
        };

        const cleanPrice = (priceStr) => {
            if (!priceStr) return null;
            const match = String(priceStr).replace(/[,$]/g, '').match(/[\d,]+/);
            return match ? parseInt(match[0].replace(/,/g, ''), 10) : null;
        };

        const cleanMileage = (mileageStr) => {
            if (!mileageStr) return null;
            const match = String(mileageStr).replace(/,/g, '').match(/[\d,]+/);
            return match ? parseInt(match[0].replace(/,/g, ''), 10) : null;
        };

        const buildStartUrl = (pageOffset = 0) => {
            const pathParts = ['https://www.autotrader.ca/cars'];

            if (make) pathParts.push(encodeURIComponent(make.toLowerCase()));
            if (model) pathParts.push(encodeURIComponent(model.toLowerCase()));
            if (province) pathParts.push(encodeURIComponent(province.toLowerCase()));
            if (city) pathParts.push(encodeURIComponent(city.toLowerCase()));

            const u = new URL(pathParts.join('/') + '/');

            // Home delivery filter
            u.searchParams.set('hprc', 'True');
            u.searchParams.set('wcp', 'True');

            // Pagination
            u.searchParams.set('rcp', String(PAGE_SIZE));
            u.searchParams.set('rcs', String(pageOffset));

            // Year range
            if (minYear) u.searchParams.set('yRng', `${minYear},${maxYear || ''}`);
            else if (maxYear) u.searchParams.set('yRng', `,${maxYear}`);

            // Price range
            if (minPrice) u.searchParams.set('prx', String(minPrice));
            if (maxPrice) u.searchParams.set('prxmax', String(maxPrice));

            // Mileage range
            if (minMileage) u.searchParams.set('oRng', `${minMileage},${maxMileage || ''}`);
            else if (maxMileage) u.searchParams.set('oRng', `,${maxMileage}`);

            return u.href;
        };

        // Initial URLs
        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls);
        if (startUrl) initial.push(startUrl);
        if (url) initial.push(url);
        if (!initial.length) initial.push(buildStartUrl(0));

        const proxyConf = proxyConfiguration
            ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
            : undefined;

        let saved = 0;
        const seenUrls = new Set();

        // Extract data from ngVdpModel JSON (detail pages)
        function extractFromNgVdpModel($) {
            const scripts = $('script');
            for (let i = 0; i < scripts.length; i++) {
                const content = $(scripts[i]).html() || '';
                // Try multiple patterns for the model data
                const patterns = [
                    /window\['ngVdpModel'\]\s*=\s*({[\s\S]*?});/,
                    /window\.ngVdpModel\s*=\s*({[\s\S]*?});/,
                    /__NEXT_DATA__.*?({[\s\S]*?})<\/script>/,
                ];
                for (const pattern of patterns) {
                    const match = content.match(pattern);
                    if (match) {
                        try {
                            return JSON.parse(match[1]);
                        } catch { /* continue */ }
                    }
                }
            }
            return null;
        }

        // Extract from JSON-LD schema  
        function extractFromJsonLd($) {
            const scripts = $('script[type="application/ld+json"]');
            for (let i = 0; i < scripts.length; i++) {
                try {
                    const parsed = JSON.parse($(scripts[i]).html() || '');
                    const items = Array.isArray(parsed) ? parsed : [parsed];
                    for (const item of items) {
                        if (item && (item['@type'] === 'Vehicle' || item['@type'] === 'Car' || item['@type'] === 'Product' || item['@type'] === 'Offer')) {
                            return item;
                        }
                    }
                } catch { /* ignore */ }
            }
            return null;
        }

        // Parse vehicle data from ngVdpModel - improved mapping
        function parseVdpModel(data, url) {
            if (!data) return null;

            // Navigate through potential nested structures
            const hero = data.hero || data.vehicle || data.listing || data || {};
            const specs = data.specifications || data.specs || hero.specifications || hero.specs || {};
            const seller = data.seller || data.dealer || hero.seller || hero.dealer || {};
            const pricing = data.pricing || data.price || hero.pricing || hero.price || {};
            const media = data.media || data.images || data.gallery || hero.media || {};
            const vehicle = data.vehicle || hero.vehicle || hero || {};

            // Extract ad ID from URL if not in data
            const urlAdId = url.match(/\/a\/[^\/]+\/[^\/]+\/[^\/]+\/[^\/]+\/(\d+_[^\/]+)/)?.[1] ||
                url.match(/\/(\d+_[^\/\?]+)/)?.[1];

            return {
                ad_id: data.adId || hero.adId || vehicle.adId || urlAdId || null,
                make: vehicle.make || hero.make || specs.make || null,
                model: vehicle.model || hero.model || specs.model || null,
                year: vehicle.year || hero.year || specs.year || null,
                trim: vehicle.trim || hero.trim || specs.trim || null,
                price: pricing.price || pricing.amount || hero.price || cleanPrice(pricing.displayPrice) || null,
                price_formatted: pricing.displayPrice || pricing.formattedPrice || hero.displayPrice ||
                    (pricing.price ? `$${pricing.price.toLocaleString()}` : null),
                mileage: specs.mileage || specs.odometer || specs.kilometres || vehicle.mileage || null,
                mileage_formatted: specs.displayMileage || specs.formattedMileage ||
                    (specs.mileage ? `${specs.mileage.toLocaleString()} km` : null),
                transmission: specs.transmission || vehicle.transmission || null,
                drivetrain: specs.drivetrain || specs.driveTrain || specs.driveType || vehicle.drivetrain || null,
                body_type: specs.bodyType || specs.bodyStyle || specs.body || vehicle.bodyType || null,
                exterior_color: specs.exteriorColour || specs.exteriorColor || specs.colour || vehicle.exteriorColour || null,
                interior_color: specs.interiorColour || specs.interiorColor || vehicle.interiorColour || null,
                fuel_type: specs.fuelType || specs.fuel || vehicle.fuelType || null,
                engine: specs.engine || specs.engineDescription || vehicle.engine || null,
                doors: specs.doors || specs.numberOfDoors || vehicle.doors || null,
                seats: specs.seatingCapacity || specs.seats || specs.passengers || vehicle.seats || null,
                city: seller.city || seller.location?.city || vehicle.city || null,
                province: seller.province || seller.state || seller.location?.province || vehicle.province || null,
                seller_name: seller.name || seller.dealerName || seller.sellerName || null,
                is_private_seller: seller.isPrivate || seller.privateSeller || seller.isPrivateSeller || false,
                dealer_id: seller.dealerId || seller.id || null,
                description: data.description || hero.description || vehicle.description || null,
                images: extractImages(media),
                vehicle_status: hero.status || specs.status || vehicle.status || 'Used',
                vin: specs.vin || vehicle.vin || null,
                stock_number: specs.stockNumber || specs.stock || vehicle.stockNumber || null,
                features: data.features || hero.features || vehicle.features || [],
                url: url,
            };
        }

        function extractImages(media) {
            if (!media) return [];
            const images = media.images || media.gallery || media.photos || [];
            if (Array.isArray(images)) {
                return images.map(img => {
                    if (typeof img === 'string') return img.split('?')[0];
                    return (img.url || img.src || img.href || '').split('?')[0];
                }).filter(Boolean);
            }
            return [];
        }

        // HTML fallback extraction - improved with better selectors
        function extractFromHtml($, url) {
            // Parse title for year/make/model
            const title = $('h1').first().text().trim();
            const titleMatch = title.match(/^(\d{4})\s+(\w+)\s+(.+)/);

            // Price extraction with multiple selectors
            const priceSelectors = [
                '[data-testid="hero-price"]',
                '.hero-price',
                '[class*="price-amount"]',
                '[class*="listing-price"]',
                '.price-container',
                '[class*="Price"]',
                'span[class*="price"]',
            ];
            let priceText = null;
            for (const sel of priceSelectors) {
                const el = $(sel).first();
                if (el.length) {
                    priceText = el.text().trim();
                    if (priceText && priceText.includes('$')) break;
                }
            }

            // Mileage extraction
            const mileageSelectors = [
                '[data-testid="mileage"]',
                '[class*="mileage"]',
                '[class*="odometer"]',
                '[class*="kilometres"]',
            ];
            let mileageText = null;
            for (const sel of mileageSelectors) {
                const el = $(sel).first();
                if (el.length) {
                    mileageText = el.text().trim();
                    if (mileageText && /\d/.test(mileageText)) break;
                }
            }

            // Image extraction
            const images = [];
            $('img[src*="images.autotrader.ca"], [class*="gallery"] img, [class*="carousel"] img, [class*="photo"] img').each((_, img) => {
                const src = $(img).attr('src') || $(img).attr('data-src');
                if (src && !src.includes('placeholder') && !src.includes('logo')) {
                    images.push(src.split('?')[0]);
                }
            });

            // Spec value extractor
            const getSpecValue = (labels) => {
                const labelList = Array.isArray(labels) ? labels : [labels];
                for (const label of labelList) {
                    // Try definition list
                    let row = $(`dt:contains("${label}")`).first();
                    if (row.length) {
                        const val = row.next('dd').text().trim();
                        if (val) return val;
                    }
                    // Try table
                    row = $(`th:contains("${label}"), td:contains("${label}")`).first();
                    if (row.length) {
                        const val = row.next('td').text().trim() || row.parent().find('td').last().text().trim();
                        if (val) return val;
                    }
                    // Try label/value pairs
                    row = $(`[class*="label"]:contains("${label}"), [class*="spec-label"]:contains("${label}")`).first();
                    if (row.length) {
                        const val = row.next().text().trim() || row.parent().find('[class*="value"]').text().trim();
                        if (val) return val;
                    }
                }
                return null;
            };

            // Location extraction
            const locationText = $('[class*="location"], [data-testid="location"], [class*="dealer-location"]').first().text().trim();
            const locationParts = locationText.split(',').map(s => s.trim());

            // Seller extraction
            const sellerName = $('[class*="dealer-name"], [class*="seller-name"], [data-testid="dealer-name"], [class*="dealership"]').first().text().trim();

            // Extract ad ID from URL
            const urlAdId = url.match(/\/(\d+_[^\/\?]+)/)?.[1] || url.match(/\/a\/[^\/]+\/[^\/]+\/[^\/]+\/[^\/]+\/([^\/\?]+)/)?.[1];

            return {
                ad_id: urlAdId || null,
                make: titleMatch?.[2] || null,
                model: titleMatch?.[3]?.split(' ')[0] || null,
                year: titleMatch?.[1] ? parseInt(titleMatch[1], 10) : null,
                trim: titleMatch?.[3]?.split(' ').slice(1).join(' ') || null,
                price: cleanPrice(priceText),
                price_formatted: priceText || null,
                mileage: cleanMileage(mileageText),
                mileage_formatted: mileageText || null,
                transmission: getSpecValue(['Transmission', 'Trans']),
                drivetrain: getSpecValue(['Drivetrain', 'Drive Train', 'Drive Type']),
                body_type: getSpecValue(['Body Type', 'Body Style', 'Body']),
                exterior_color: getSpecValue(['Exterior Colour', 'Exterior Color', 'Colour', 'Color']),
                interior_color: getSpecValue(['Interior Colour', 'Interior Color']),
                fuel_type: getSpecValue(['Fuel Type', 'Fuel']),
                engine: getSpecValue(['Engine', 'Engine Type']),
                doors: (() => { const d = getSpecValue(['Doors', 'Number of Doors']); return d ? parseInt(d, 10) : null; })(),
                seats: getSpecValue(['Seats', 'Seating Capacity', 'Passengers']),
                city: locationParts[0] || null,
                province: locationParts[1] || null,
                seller_name: sellerName || null,
                is_private_seller: $('[class*="private"]').length > 0 || /private/i.test($('body').text()),
                dealer_id: null,
                description: $('[class*="description"], [data-testid="description"], .vehicle-description').first().text().trim() || null,
                images: [...new Set(images)],
                vehicle_status: 'Used',
                vin: getSpecValue(['VIN', 'Vehicle Identification Number']),
                stock_number: getSpecValue(['Stock', 'Stock Number', 'Stock #']),
                features: [],
                url: url,
            };
        }

        // Find vehicle listing links
        function findListingLinks($, base) {
            const links = new Set();
            $('a[href*="/a/"]').each((_, a) => {
                const href = $(a).attr('href');
                if (href && /\/a\/[a-zA-Z0-9\-]+/.test(href)) {
                    const abs = toAbs(href, base);
                    if (abs && !seenUrls.has(abs)) {
                        links.add(abs);
                        seenUrls.add(abs);
                    }
                }
            });
            return [...links];
        }

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            maxConcurrency: 5,
            requestHandlerTimeoutSecs: 60,
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 1;

                if (label === 'LIST') {
                    const links = findListingLinks($, request.url);
                    crawlerLog.info(`Page ${pageNo}: Found ${links.length} vehicle listings`, { url: request.url });

                    if (links.length) {
                        const remaining = RESULTS_WANTED - saved;
                        const toEnqueue = links.slice(0, Math.max(0, remaining));
                        if (toEnqueue.length) {
                            await enqueueLinks({ urls: toEnqueue, userData: { label: 'DETAIL' } });
                        }
                    }

                    // Pagination
                    if (saved < RESULTS_WANTED && pageNo < MAX_PAGES && links.length > 0) {
                        const nextOffset = pageNo * PAGE_SIZE;
                        const nextUrl = buildStartUrl(nextOffset);
                        await enqueueLinks({
                            urls: [nextUrl],
                            userData: { label: 'LIST', pageNo: pageNo + 1 }
                        });
                    }
                    return;
                }

                if (label === 'DETAIL') {
                    if (saved >= RESULTS_WANTED) return;

                    try {
                        let vehicle = null;

                        // Try ngVdpModel first
                        const vdpData = extractFromNgVdpModel($);
                        if (vdpData) {
                            vehicle = parseVdpModel(vdpData, request.url);
                        }

                        // Try JSON-LD fallback
                        if (!vehicle || !vehicle.make) {
                            const jsonLd = extractFromJsonLd($);
                            if (jsonLd) {
                                const existing = vehicle || {};
                                vehicle = {
                                    ...existing,
                                    make: jsonLd.brand?.name || jsonLd.manufacturer || existing.make,
                                    model: jsonLd.model || jsonLd.name?.split(' ').slice(1).join(' ') || existing.model,
                                    price: jsonLd.offers?.price || existing.price,
                                    price_formatted: jsonLd.offers?.priceCurrency ?
                                        `$${jsonLd.offers.price?.toLocaleString()}` : existing.price_formatted,
                                    description: jsonLd.description || existing.description,
                                    images: jsonLd.image ? [jsonLd.image].flat() : existing.images,
                                };
                            }
                        }

                        // HTML fallback - always merge to fill gaps
                        const htmlData = extractFromHtml($, request.url);
                        if (!vehicle) {
                            vehicle = htmlData;
                        } else {
                            // Fill in missing fields from HTML
                            for (const [key, value] of Object.entries(htmlData)) {
                                if (vehicle[key] === null || vehicle[key] === undefined || vehicle[key] === '') {
                                    vehicle[key] = value;
                                }
                            }
                        }

                        if (vehicle && (vehicle.make || vehicle.model || vehicle.price)) {
                            await Dataset.pushData(vehicle);
                            saved++;

                            if (saved % 10 === 0) {
                                crawlerLog.info(`Progress: ${saved}/${RESULTS_WANTED} vehicles scraped`);
                            }
                        }
                    } catch (err) {
                        crawlerLog.warning(`Failed to extract: ${request.url}`, { error: err.message });
                    }
                }
            },
            failedRequestHandler({ request, log: crawlerLog }, error) {
                crawlerLog.warning(`Request failed: ${request.url}`, { error: error.message });
            },
        });

        log.info(`Starting Autotrader.ca scraper`, {
            make, model, province,
            resultsWanted: RESULTS_WANTED,
            maxPages: MAX_PAGES
        });

        await crawler.run(initial.map(u => ({ url: u, userData: { label: 'LIST', pageNo: 1 } })));

        log.info(`Scraping complete. Total vehicles saved: ${saved}`);

    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    console.error('Actor failed:', err);
    process.exit(1);
});
