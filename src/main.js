// Autotrader.ca Home Delivery Scraper - Optimized for speed and stealth
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
            results_wanted: RESULTS_WANTED_RAW = 20,
            max_pages: MAX_PAGES_RAW = 20,
            startUrl,
            startUrls,
            url,
            proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : 20;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 20;
        const PAGE_SIZE = 15;
        const BATCH_SIZE = 10;

        const toAbs = (href, base = 'https://www.autotrader.ca') => {
            try { return new URL(href, base).href; } catch { return null; }
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

        const buildPaginationUrl = (baseUrl, pageOffset) => {
            const u = new URL(baseUrl);
            u.searchParams.set('rcp', String(PAGE_SIZE));
            u.searchParams.set('rcs', String(pageOffset));
            return u.href;
        };

        const buildStartUrl = () => {
            let baseUrl = 'https://www.autotrader.ca/home-delivery/';

            if (make || model || province || city) {
                const pathParts = ['https://www.autotrader.ca/cars'];
                if (make) pathParts.push(encodeURIComponent(make.toLowerCase()));
                if (model) pathParts.push(encodeURIComponent(model.toLowerCase()));
                if (province) pathParts.push(encodeURIComponent(province.toLowerCase()));
                if (city) pathParts.push(encodeURIComponent(city.toLowerCase()));
                baseUrl = pathParts.join('/') + '/';
            }

            const u = new URL(baseUrl);
            u.searchParams.set('hprc', 'True');
            u.searchParams.set('wcp', 'True');
            u.searchParams.set('rcp', String(PAGE_SIZE));
            u.searchParams.set('rcs', '0');

            if (minYear) u.searchParams.set('yRng', `${minYear},${maxYear || ''}`);
            else if (maxYear) u.searchParams.set('yRng', `,${maxYear}`);
            if (minPrice) u.searchParams.set('prx', String(minPrice));
            if (maxPrice) u.searchParams.set('prxmax', String(maxPrice));
            if (minMileage) u.searchParams.set('oRng', `${minMileage},${maxMileage || ''}`);
            else if (maxMileage) u.searchParams.set('oRng', `,${maxMileage}`);

            return u.href;
        };

        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls);
        if (startUrl) initial.push(startUrl);
        if (url) initial.push(url);
        if (!initial.length) initial.push(buildStartUrl());

        const proxyConf = proxyConfiguration
            ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
            : undefined;

        let saved = 0;
        const seenUrls = new Set();
        let baseListUrl = null;
        const dataBatch = [];

        // Batch push data for efficiency
        async function flushBatch() {
            if (dataBatch.length > 0) {
                await Dataset.pushData(dataBatch);
                dataBatch.length = 0;
            }
        }

        // Extract data from page scripts - optimized
        function extractPageData($) {
            let result = null;
            $('script').each((_, el) => {
                if (result) return false;
                const content = $(el).html() || '';
                const vdpMatch = content.match(/window\['ngVdpModel'\]\s*=\s*({[\s\S]*?});/);
                if (vdpMatch) {
                    try { result = { type: 'vdp', data: JSON.parse(vdpMatch[1]) }; return false; } catch { }
                }
            });
            return result;
        }

        // Deep search for a value - optimized with early return
        function deepFind(obj, keys, maxDepth = 4) {
            if (!obj || maxDepth <= 0) return null;
            const keyList = Array.isArray(keys) ? keys : [keys];

            for (const key of keyList) {
                if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
            }

            if (typeof obj === 'object') {
                for (const val of Object.values(obj)) {
                    if (val && typeof val === 'object') {
                        const found = deepFind(val, keys, maxDepth - 1);
                        if (found !== null) return found;
                    }
                }
            }
            return null;
        }

        // Parse vehicle data - optimized
        function parseVehicleJson(pageData, url) {
            if (!pageData) return null;
            const data = pageData.data || pageData;
            const urlAdId = url.match(/\/(\d+_[^\/\?]+)/)?.[1];

            // Handle description
            let description = null;
            const descData = deepFind(data, ['description', 'additionalInfo']);
            if (descData) {
                if (Array.isArray(descData)) {
                    description = descData.map(d => typeof d === 'object' ? d.description : d).filter(Boolean).join('\n');
                } else if (typeof descData === 'object' && descData.description) {
                    const inner = descData.description;
                    description = Array.isArray(inner) ? inner.map(d => typeof d === 'object' ? d.description : d).filter(Boolean).join('\n') : inner;
                } else {
                    description = String(descData);
                }
            }

            // Extract images
            let images = [];
            const mediaData = deepFind(data, ['images', 'media', 'gallery']);
            if (mediaData) {
                const imgList = Array.isArray(mediaData) ? mediaData : (mediaData.images || mediaData.gallery || []);
                images = imgList.slice(0, 10).map(img => (typeof img === 'string' ? img : (img.url || img.src || '')).split('?')[0]).filter(Boolean);
            }

            const seller = deepFind(data, ['seller', 'dealer']) || {};
            const location = deepFind(data, ['location', 'address']) || {};

            return {
                ad_id: deepFind(data, ['adId', 'id', 'listingId']) || urlAdId,
                make: deepFind(data, ['make', 'manufacturer', 'brand']),
                model: deepFind(data, ['model', 'modelName']),
                year: deepFind(data, ['year', 'modelYear']),
                trim: deepFind(data, ['trim', 'trimLevel']),
                price: deepFind(data, ['price', 'askingPrice']),
                price_formatted: deepFind(data, ['displayPrice', 'formattedPrice']),
                mileage: deepFind(data, ['mileage', 'odometer', 'kilometres']),
                mileage_formatted: deepFind(data, ['displayMileage', 'formattedMileage']),
                transmission: deepFind(data, ['transmission']),
                drivetrain: deepFind(data, ['drivetrain', 'driveTrain']),
                body_type: deepFind(data, ['bodyType', 'bodyStyle', 'body']),
                exterior_color: deepFind(data, ['exteriorColour', 'exteriorColor', 'colour']),
                interior_color: deepFind(data, ['interiorColour', 'interiorColor']),
                fuel_type: deepFind(data, ['fuelType', 'fuel']),
                engine: deepFind(data, ['engine', 'engineDescription']),
                doors: deepFind(data, ['doors', 'numberOfDoors']),
                seats: deepFind(data, ['seatingCapacity', 'seats']),
                city: seller.city || location.city || deepFind(data, ['city', 'dealerCity']),
                province: seller.province || seller.state || location.province || deepFind(data, ['province', 'state']),
                seller_name: seller.name || seller.dealerName || deepFind(data, ['dealerName', 'sellerName']),
                is_private_seller: deepFind(data, ['isPrivate', 'privateSeller']) || false,
                dealer_id: seller.dealerId || seller.id || deepFind(data, ['dealerId']),
                description,
                images,
                vehicle_status: deepFind(data, ['status', 'condition']) || 'Used',
                vin: deepFind(data, ['vin']),
                stock_number: deepFind(data, ['stockNumber', 'stock']),
                features: deepFind(data, ['features', 'options']) || [],
                url,
            };
        }

        // HTML fallback - optimized with fewer selectors
        function extractFromHtml($, url) {
            const title = $('h1').first().text().trim();
            const titleMatch = title.match(/^(\d{4})\s+(\w+)\s+(.+)/);

            const priceEl = $('[class*="price"]').first();
            const priceText = priceEl.text().trim();

            const mileageEl = $('[class*="mileage"], [class*="odometer"]').first();
            const mileageText = mileageEl.text().trim();

            const images = [];
            $('img[src*="images.autotrader.ca"]').slice(0, 10).each((_, img) => {
                const src = $(img).attr('src') || $(img).attr('data-src');
                if (src) images.push(src.split('?')[0]);
            });

            const getSpec = (label) => {
                const el = $(`dt:contains("${label}")`).first();
                return el.length ? el.next('dd').text().trim() : null;
            };

            const locationText = $('[class*="location"]').first().text().trim();
            const provMatch = locationText.match(/\b(ON|BC|AB|QC|MB|SK|NS|NB|NL|PE|NT|YT|NU)\b/i);

            const urlAdId = url.match(/\/(\d+_[^\/\?]+)/)?.[1];

            return {
                ad_id: urlAdId,
                make: titleMatch?.[2],
                model: titleMatch?.[3]?.split(' ')[0],
                year: titleMatch?.[1] ? parseInt(titleMatch[1], 10) : null,
                trim: titleMatch?.[3]?.split(' ').slice(1).join(' ') || null,
                price: cleanPrice(priceText),
                price_formatted: priceText || null,
                mileage: cleanMileage(mileageText),
                mileage_formatted: mileageText || null,
                transmission: getSpec('Transmission'),
                drivetrain: getSpec('Drivetrain'),
                body_type: getSpec('Body Type') || getSpec('Body Style'),
                exterior_color: getSpec('Exterior Colour'),
                interior_color: getSpec('Interior Colour'),
                fuel_type: getSpec('Fuel Type'),
                engine: getSpec('Engine'),
                doors: (() => { const d = getSpec('Doors'); return d ? parseInt(d, 10) : null; })(),
                seats: getSpec('Seats'),
                city: provMatch ? locationText.replace(provMatch[0], '').replace(/,/g, '').trim() : null,
                province: provMatch?.[1] || null,
                seller_name: $('[class*="dealer-name"]').first().text().trim() || null,
                is_private_seller: /private/i.test($('body').text()),
                dealer_id: null,
                description: $('[class*="description"]').first().text().trim() || null,
                images: [...new Set(images)],
                vehicle_status: /\bnew\b/i.test(title) ? 'New' : 'Used',
                vin: getSpec('VIN'),
                stock_number: getSpec('Stock'),
                features: [],
                url,
            };
        }

        // Find listing links - optimized
        function findListingLinks($, base) {
            const links = new Set();
            $('a[href*="/a/"]').each((_, a) => {
                const href = $(a).attr('href');
                if (href && /\/a\/[a-zA-Z0-9%\-]+\/[a-zA-Z0-9%\-]+/.test(href)) {
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
            maxRequestRetries: 2,
            useSessionPool: true,
            persistCookiesPerSession: true,
            sessionPoolOptions: {
                maxPoolSize: 50,
                sessionOptions: {
                    maxUsageCount: 20,
                },
            },
            // Speed optimizations
            maxConcurrency: 10,
            minConcurrency: 3,
            requestHandlerTimeoutSecs: 30,
            navigationTimeoutSecs: 30,
            // Stealth settings
            additionalMimeTypes: ['application/json'],
            suggestResponseEncoding: 'utf-8',
            async requestHandler({ request, $, enqueueLinks }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 1;

                if (label === 'LIST') {
                    if (pageNo === 1) {
                        const u = new URL(request.url);
                        u.searchParams.delete('rcs');
                        u.searchParams.delete('rcp');
                        baseListUrl = u.href;
                    }

                    const links = findListingLinks($, request.url);
                    log.info(`Page ${pageNo}: ${links.length} listings`, { url: request.url });

                    if (links.length && saved < RESULTS_WANTED) {
                        const remaining = RESULTS_WANTED - saved;
                        const toEnqueue = links.slice(0, Math.max(0, remaining));
                        if (toEnqueue.length) {
                            await enqueueLinks({ urls: toEnqueue, userData: { label: 'DETAIL' } });
                        }
                    }

                    if (saved + links.length < RESULTS_WANTED && pageNo < MAX_PAGES && links.length > 0) {
                        const nextOffset = pageNo * PAGE_SIZE;
                        const nextUrl = buildPaginationUrl(baseListUrl || request.url, nextOffset);
                        await enqueueLinks({ urls: [nextUrl], userData: { label: 'LIST', pageNo: pageNo + 1 } });
                    }
                    return;
                }

                if (label === 'DETAIL' && saved < RESULTS_WANTED) {
                    try {
                        let vehicle = null;
                        const pageData = extractPageData($);
                        if (pageData) vehicle = parseVehicleJson(pageData, request.url);

                        const htmlData = extractFromHtml($, request.url);
                        if (!vehicle) {
                            vehicle = htmlData;
                        } else {
                            for (const [key, value] of Object.entries(htmlData)) {
                                if (vehicle[key] === null || vehicle[key] === undefined ||
                                    (Array.isArray(vehicle[key]) && vehicle[key].length === 0)) {
                                    vehicle[key] = value;
                                }
                            }
                        }

                        if (vehicle.price && !vehicle.price_formatted) {
                            vehicle.price_formatted = `$${Number(vehicle.price).toLocaleString()}`;
                        }
                        if (vehicle.mileage && !vehicle.mileage_formatted) {
                            vehicle.mileage_formatted = `${Number(vehicle.mileage).toLocaleString()} km`;
                        }

                        if (vehicle && (vehicle.make || vehicle.model || vehicle.price)) {
                            dataBatch.push(vehicle);
                            saved++;

                            if (dataBatch.length >= BATCH_SIZE) {
                                await flushBatch();
                                log.info(`Progress: ${saved}/${RESULTS_WANTED} vehicles`);
                            }
                        }
                    } catch (err) {
                        log.debug(`Extract error: ${request.url}`, { error: err.message });
                    }
                }
            },
            failedRequestHandler({ request }, error) {
                log.debug(`Failed: ${request.url}`, { error: error.message });
            },
        });

        log.info(`Starting scraper`, { make, model, province, resultsWanted: RESULTS_WANTED, maxPages: MAX_PAGES });

        await crawler.run(initial.map(u => ({ url: u, userData: { label: 'LIST', pageNo: 1 } })));

        await flushBatch();
        log.info(`Complete. Saved: ${saved} vehicles`);

    } finally {
        await Actor.exit();
    }
}

main().catch(err => { console.error('Actor failed:', err); process.exit(1); });
