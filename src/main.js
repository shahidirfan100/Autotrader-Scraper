// Autotrader.ca Home Delivery Scraper - CheerioCrawler implementation
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';

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
            bodyType = '',
            fuelType = '',
            transmission = '',
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
            if (!text) return '';
            return String(text).replace(/\s+/g, ' ').trim();
        };

        const cleanPrice = (priceStr) => {
            if (!priceStr) return null;
            const match = String(priceStr).replace(/[,$]/g, '').match(/\d+/);
            return match ? parseInt(match[0], 10) : null;
        };

        const cleanMileage = (mileageStr) => {
            if (!mileageStr) return null;
            const match = String(mileageStr).replace(/,/g, '').match(/\d+/);
            return match ? parseInt(match[0], 10) : null;
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

            // Other filters
            if (bodyType) u.searchParams.set('body', bodyType);
            if (fuelType) u.searchParams.set('fuel', fuelType);
            if (transmission) u.searchParams.set('trans', transmission);

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
                const match = content.match(/window\['ngVdpModel'\]\s*=\s*({[\s\S]*?});/);
                if (match) {
                    try {
                        const data = JSON.parse(match[1]);
                        return data;
                    } catch { /* continue */ }
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
                        if (item && (item['@type'] === 'Vehicle' || item['@type'] === 'Car' || item['@type'] === 'Product')) {
                            return item;
                        }
                    }
                } catch { /* ignore */ }
            }
            return null;
        }

        // Parse vehicle data from ngVdpModel
        function parseVdpModel(data, url) {
            if (!data) return null;

            const hero = data.hero || {};
            const specs = data.specifications || {};
            const seller = data.seller || {};
            const pricing = data.pricing || {};
            const media = data.media || {};

            return {
                ad_id: data.adId || hero.adId || null,
                make: hero.make || specs.make || null,
                model: hero.model || specs.model || null,
                year: hero.year || specs.year || null,
                trim: hero.trim || specs.trim || null,
                price: pricing.price || hero.price || null,
                price_formatted: pricing.displayPrice || hero.displayPrice || null,
                mileage: specs.mileage || specs.odometer || null,
                mileage_formatted: specs.displayMileage || null,
                transmission: specs.transmission || null,
                drivetrain: specs.drivetrain || specs.driveTrain || null,
                body_type: specs.bodyType || specs.bodyStyle || null,
                exterior_color: specs.exteriorColour || specs.exteriorColor || null,
                interior_color: specs.interiorColour || specs.interiorColor || null,
                fuel_type: specs.fuelType || null,
                engine: specs.engine || null,
                doors: specs.doors || specs.numberOfDoors || null,
                seats: specs.seatingCapacity || specs.seats || null,
                city: seller.city || null,
                province: seller.province || seller.state || null,
                seller_name: seller.name || seller.dealerName || null,
                is_private_seller: seller.isPrivate || seller.privateSeller || false,
                dealer_id: seller.dealerId || null,
                description: data.description || hero.description || null,
                images: (media.images || media.gallery || []).map(img =>
                    typeof img === 'string' ? img.split('?')[0] : (img.url || img.src || '').split('?')[0]
                ).filter(Boolean),
                vehicle_status: hero.status || specs.status || 'Used',
                vin: specs.vin || null,
                stock_number: specs.stockNumber || null,
                features: data.features || [],
                url: url,
            };
        }

        // HTML fallback extraction
        function extractFromHtml($, url) {
            const title = $('h1').first().text().trim();
            const titleMatch = title.match(/^(\d{4})\s+(\w+)\s+(.+)/);

            const priceText = $('[class*="price"], .hero-price, [data-testid="price"]').first().text();
            const mileageText = $('[class*="mileage"], [class*="odometer"], [data-testid="mileage"]').first().text();

            const images = [];
            $('img[src*="images.autotrader.ca"], [class*="gallery"] img').each((_, img) => {
                const src = $(img).attr('src') || $(img).attr('data-src');
                if (src) images.push(src.split('?')[0]);
            });

            const getSpecValue = (label) => {
                const row = $(`dt:contains("${label}"), th:contains("${label}"), [class*="label"]:contains("${label}")`).first();
                if (row.length) {
                    return row.next().text().trim() || row.parent().find('dd, td, [class*="value"]').text().trim();
                }
                return null;
            };

            return {
                ad_id: url.match(/\/a\/([^\/\?]+)/)?.[1] || null,
                make: titleMatch?.[2] || null,
                model: titleMatch?.[3]?.split(' ')[0] || null,
                year: titleMatch?.[1] ? parseInt(titleMatch[1], 10) : null,
                trim: null,
                price: cleanPrice(priceText),
                price_formatted: priceText?.trim() || null,
                mileage: cleanMileage(mileageText),
                mileage_formatted: mileageText?.trim() || null,
                transmission: getSpecValue('Transmission'),
                drivetrain: getSpecValue('Drivetrain') || getSpecValue('Drive Train'),
                body_type: getSpecValue('Body Type') || getSpecValue('Body Style'),
                exterior_color: getSpecValue('Exterior Colour') || getSpecValue('Exterior Color'),
                interior_color: getSpecValue('Interior Colour') || getSpecValue('Interior Color'),
                fuel_type: getSpecValue('Fuel Type'),
                engine: getSpecValue('Engine'),
                doors: getSpecValue('Doors') ? parseInt(getSpecValue('Doors'), 10) : null,
                seats: getSpecValue('Seats') || getSpecValue('Seating Capacity'),
                city: $('[class*="location"] [class*="city"], [data-testid="city"]').first().text().trim() || null,
                province: $('[class*="location"] [class*="province"], [data-testid="province"]').first().text().trim() || null,
                seller_name: $('[class*="dealer-name"], [class*="seller-name"], [data-testid="dealer-name"]').first().text().trim() || null,
                is_private_seller: $('[class*="private"]').length > 0,
                dealer_id: null,
                description: $('[class*="description"], [data-testid="description"]').first().text().trim() || null,
                images: [...new Set(images)],
                vehicle_status: 'Used',
                vin: getSpecValue('VIN'),
                stock_number: getSpecValue('Stock') || getSpecValue('Stock Number'),
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
            additionalMimeTypes: ['application/json'],
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
                        // Try ngVdpModel first
                        const vdpData = extractFromNgVdpModel($);
                        let vehicle = vdpData ? parseVdpModel(vdpData, request.url) : null;

                        // Try JSON-LD fallback
                        if (!vehicle || !vehicle.make) {
                            const jsonLd = extractFromJsonLd($);
                            if (jsonLd) {
                                vehicle = {
                                    ...vehicle,
                                    make: jsonLd.brand?.name || jsonLd.manufacturer || vehicle?.make,
                                    model: jsonLd.model || vehicle?.model,
                                    price: jsonLd.offers?.price || vehicle?.price,
                                    description: jsonLd.description || vehicle?.description,
                                };
                            }
                        }

                        // HTML fallback
                        if (!vehicle || !vehicle.make) {
                            vehicle = extractFromHtml($, request.url);
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
