import Document, { Html, Head, Main, NextScript } from 'next/document';
import type { DocumentContext } from 'next/document';

export default class AppDocument extends Document<{ nonce: string }> {
  static async getInitialProps(ctx: DocumentContext) {
    const initial = await Document.getInitialProps(ctx);
    const nonce = (ctx.req && ctx.req.headers && ctx.req.headers['x-nonce']) || '';
    return { ...initial, nonce };
  }
  render() {
    const { nonce } = this.props;
    const shell = this.props.__NEXT_DATA__ && this.props.__NEXT_DATA__.props && this.props.__NEXT_DATA__.props.pageProps && this.props.__NEXT_DATA__.props.pageProps.shell;
    return (
      <Html lang="id">
        <Head nonce={nonce}>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" />
        </Head>
        <body className={shell === 'app' ? 'app' : undefined}>
          <Main />
          <NextScript nonce={nonce} />
        </body>
      </Html>
    );
  }
}
